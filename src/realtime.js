const { Server } = require("socket.io");
const { supabase } = require("./config/supabase");

let io = null;

const initRealtime = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*", // Adjust in production to process.env.CLIENT_URL
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Authentication Middleware with End-to-End Resilience
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error: No token provided"));

    let attempts = 3;
    let lastError = null;

    while (attempts > 0) {
      try {
        // 1. Verify Token with Supabase Auth
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        
        if (authError) {
          // If it's a network timeout, we retry. Otherwise, it's a hard "Invalid Token" error.
          if (authError.message?.includes("fetch failed") || authError.message?.includes("timeout")) {
            throw authError; // Trigger retry in catch block
          }
          return next(new Error("Authentication error: Invalid session"));
        }

        if (!user) return next(new Error("Authentication error: User not found"));

        // 2. Fetch Profile with Role & Full Name (schema-resilient)
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("role, full_name")
          .eq("id", user.id)
          .maybeSingle();
        
        if (profileError) {
          const isTransient = profileError.message?.includes("fetch") || 
                              profileError.message?.includes("timeout") ||
                              profileError.status === 503;
                              
          if (isTransient) {
            throw profileError; // Trigger retry in catch block
          }
          console.error(`[Realtime] DB Error for user ${user.id}:`, profileError.message);
          return next(new Error(`Authentication error: Database issue (${profileError.message})`));
        }

        if (!profileData) {
          console.warn(`[Realtime] Profile missing in DB for user ${user.id}`);
          // Last ditch effort: wait a second and try one more time
          if (attempts > 1) {
            attempts--;
            await new Promise(r => setTimeout(r, 2000));
            continue; 
          }
          return next(new Error("Authentication error: Profile record missing. Please contact support."));
        }

        // Success!
        socket.user = { 
          id: user.id, 
          role: profileData.role,
          username: profileData.full_name || user.email.split('@')[0],
        };
        return next();

      } catch (err) {
        lastError = err;
        attempts--;
        if (attempts > 0) {
          console.warn(`[Realtime] Auth handshake timeout. Retrying... (${attempts} left)`);
          await new Promise(r => setTimeout(r, 1500)); // Linear backoff
        }
      }
    }

    console.error(`[Realtime] Critical handshake failure:`, lastError?.message || "Timeout");
    return next(new Error("Authentication error: Connection to security server timed out. Please try again."));
  });

  const onlineUsers = new Map(); // userId -> { id, username, role, count }

  io.on("connection", (socket) => {
    const userId = socket.user.id;
    
    // Tracking multiple tabs for the same user
    const existing = onlineUsers.get(userId);
    if (existing) {
      existing.count++;
    } else {
      onlineUsers.set(userId, {
        id: userId,
        username: socket.user.username,
        role: socket.user.role,
        count: 1
      });
    }

    console.log(`[Presence] ${socket.user.username} joined. Active users: ${onlineUsers.size}`);
    io.emit("presence:sync", Array.from(onlineUsers.values()));

    // Persist to DB for API consistency
    supabase
      .from("user_presence")
      .upsert({ 
        user_id: userId, 
        is_online: true, 
        last_seen: new Date().toISOString() 
      })
      .then(() => {
        // Broadcast to everyone using the canonical event name
        broadcastRealtime({ 
          type: "presence_updated", 
          data: { user_id: userId, is_online: true, last_seen: new Date().toISOString() } 
        });
      })
      .catch(err => console.error("[Realtime] DB Presence Update Error:", err.message));

    // Join rooms based on role
    socket.join("notifications");
    socket.join(`user:${userId}`); // Personal room for targeted events like typing
    
    if (socket.user.role === "owner" || socket.user.role === "developer") {
      socket.join("sales");
      socket.join("inventory");
      socket.join("reports");
      socket.join("dashboard");
    } else if (socket.user.role === "cashier") {
      socket.join("sales");
    }

    // 30-second heartbeat to keep connection alive through NAT/proxy timeouts
    const heartbeat = setInterval(() => socket.emit("ping"), 30_000);

    // --- Chat Events ---
    socket.on("chat:typing", (data) => {
      // data: { receiverId, isTyping }
      if (data.receiverId) {
        io.to(`user:${data.receiverId}`).emit("chat:typing", {
          senderId: userId,
          isTyping: data.isTyping
        });
      }
    });

    socket.on("disconnect", () => {
      clearInterval(heartbeat);
      const existing = onlineUsers.get(userId);
      if (existing) {
        existing.count--;
        if (existing.count <= 0) {
          onlineUsers.delete(userId);
          console.log(`[Presence] ${socket.user.username} left. Active users: ${onlineUsers.size}`);
          
          // Persist to DB
          supabase
            .from("user_presence")
            .upsert({ 
              user_id: userId, 
              is_online: false, 
              last_seen: new Date().toISOString() 
            })
            .then(() => {
              broadcastRealtime({ 
                type: "presence_updated", 
                data: { user_id: userId, is_online: false, last_seen: new Date().toISOString() } 
              });
            })
            .catch(err => console.error("[Realtime] DB Presence Disconnect Error:", err.message));
        }
      }
      io.emit("presence:sync", Array.from(onlineUsers.values()));
    });

    socket.on("error", (error) => {
      console.error(`[Realtime] Socket error for ${socket.id}:`, error);
    });
  });

  // --- Supabase Realtime Bridge ---
  
  // Bridge for Sales
  supabase
    .channel('db-sales')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, (payload) => {
      console.log("[Realtime] DB Change (Sales):", payload.new.id);
      io.to("sales").emit("sale:new", payload.new);
    })
    .subscribe();

  // Bridge for Inventory
  supabase
    .channel('db-inventory')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'inventory' }, (payload) => {
      console.log("[Realtime] DB Change (Inventory):", payload.new.product_id);
      io.to("inventory").emit("inventory:update", payload.new);
    })
    .subscribe();

  // Bridge for Notifications (if a table exists)
  supabase
    .channel('db-notifications')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
      io.to("notifications").emit("notification:new", payload.new);
    })
    .subscribe();

  return io;
};

const getIO = () => {
  if (!io) throw new Error("Realtime not initialized");
  return io;
};

// ─── SSE Client Registry ─────────────────────────────────────────────────────
const sseClients = new Set();
const addSSEClient = (res) => sseClients.add(res);
const removeSSEClient = (res) => sseClients.delete(res);

const broadcastToSSE = (eventName, data) => {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch (_) { sseClients.delete(client); }
  }
};

// ─── Legacy type → canonical event name map ───────────────────────────────────
// Ensures broadcastRealtime({ type: "sales_updated" }) emits "sale:new" which
// is exactly what Dashboard's useSocket("sale:new") listens for.
const LEGACY_MAP = {
  "sales_updated":           "sale:new",
  "inventory_updated":       "inventory:update",
  "expenses_updated":        "expense:new",
  "dashboard_refresh":       "dashboard:refresh",
  "payment_notifs_updated":  "notification:new",
  "eod_updated":             "eod:submitted",
  "product_updated":         "product:updated",
};

// ─── Unified Broadcast ────────────────────────────────────────────────────────
const broadcastRealtime = (payload, targetUserIds = null) => {
  if (!io) return;
  
  const { type, ...data } = payload;
  const eventName = type.includes(':')
    ? type
    : (LEGACY_MAP[type] || `system:${type}`);

  const eventData = { ...data, _type: type, _ts: Date.now() };

  if (targetUserIds) {
    const ids = Array.isArray(targetUserIds) ? targetUserIds : [targetUserIds];
    io.sockets.sockets.forEach((socket) => {
      if (ids.includes(socket.user?.id)) socket.emit(eventName, eventData);
    });
  } else {
    io.emit(eventName, eventData);
  }

  broadcastToSSE(eventName, eventData);
};

module.exports = { initRealtime, getIO, broadcastRealtime, addSSEClient, removeSSEClient };

