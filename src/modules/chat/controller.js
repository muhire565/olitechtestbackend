const { supabase } = require("../../config/supabase");
const { broadcastRealtime } = require("../../realtime");

exports.getContacts = async (req, res, next) => {
  try {
    const { id: currentUserId } = req.user;

    // Fetch all users except the current user
    const { data: users, error: usersError } = await supabase
      .from("profiles")
      .select("id, full_name, role, is_active")
      .neq("id", currentUserId)
      .eq("is_active", true);

    if (usersError) throw usersError;

    // Fetch last message and unread count for each user
    const contacts = await Promise.all(
      users.map(async (user) => {
        // Last message
        const { data: lastMsg } = await supabase
          .from("messages")
          .select("*")
          .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${user.id}),and(sender_id.eq.${user.id},receiver_id.eq.${currentUserId})`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Unread count
        const { count: unreadCount } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("sender_id", user.id)
          .eq("receiver_id", currentUserId)
          .eq("is_read", false);

        // Presence
        const { data: presenceData } = await supabase
          .from("user_presence")
          .select("is_online, last_seen, is_typing_to")
          .eq("user_id", user.id)
          .maybeSingle();

        return {
          ...user,
          last_message: lastMsg || null,
          unread_count: unreadCount || 0,
          presence: presenceData || { is_online: false, last_seen: null, is_typing_to: null },
        };
      })
    );

    res.json({ success: true, data: contacts });
  } catch (error) {
    next(error);
  }
};

exports.getMessages = async (req, res, next) => {
  try {
    const { id: currentUserId } = req.user;
    const { contactId } = req.params;

    if (!contactId) {
      return res.status(400).json({ success: false, error: "Missing contactId" });
    }

    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const before = req.query.before; // ISO timestamp cursor

    let q = supabase
      .from("messages")
      .select("*")
      .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${contactId}),and(sender_id.eq.${contactId},receiver_id.eq.${currentUserId})`)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) {
      q = q.lt("created_at", before);
    }

    const { data: messages, error } = await q;
    if (error) {
      console.error("[Chat] Fetch messages error:", error.message);
      throw error;
    }

    // Return in ascending order for display, but we fetched desc for cursor
    const ordered = (messages || []).reverse();
    const hasMore = (messages || []).length === limit;
    const nextCursor = hasMore ? (ordered[0]?.created_at || null) : null;

    res.json({ success: true, data: ordered, hasMore, nextCursor });
  } catch (error) {
    console.error("[Chat] Critical Fetch Messages Error:", error);
    next(error);
  }
};

exports.sendMessage = async (req, res, next) => {
  try {
    const { id: currentUserId } = req.user;
    const { receiver_id, content } = req.body;

    if (!receiver_id || !content) {
      return res.status(400).json({ success: false, error: "Missing receiver_id or content" });
    }

    const { data: message, error } = await supabase
      .from("messages")
      .insert([{ sender_id: currentUserId, receiver_id, content: content.trim(), is_read: false }])
      .select("*")
      .single();

    if (error) {
      console.error("[Chat] Send error:", error.message);
      throw error;
    }

    // Broadcast via WebSocket to sender and receiver
    broadcastRealtime({
      type: "new_message",
      data: message,
    }, [currentUserId, receiver_id]);

    res.status(201).json({ success: true, data: message });
  } catch (error) {
    console.error("[Chat] Critical Send Error:", error);
    next(error);
  }
};

exports.markAsRead = async (req, res, next) => {
  try {
    const { id: currentUserId } = req.user;
    const { contactId } = req.params;

    const { error } = await supabase
      .from("messages")
      .update({ is_read: true })
      .eq("sender_id", contactId)
      .eq("receiver_id", currentUserId)
      .eq("is_read", false);

    if (error) throw error;

    // Broadcast via WebSocket to the sender (so they see the ticks turn blue)
    broadcastRealtime({
      type: "messages_read",
      data: {
        reader_id: currentUserId,
        sender_id: contactId,
      },
    }, [contactId]);

    res.json({ success: true, data: { status: "read" } });
  } catch (error) {
    next(error);
  }
};

exports.updatePresence = async (req, res, next) => {
  try {
    const { id: currentUserId } = req.user;
    const { is_online, is_typing_to } = req.body;

    const updateData = { last_seen: new Date().toISOString() };
    if (typeof is_online === "boolean") updateData.is_online = is_online;
    if (is_typing_to !== undefined) updateData.is_typing_to = is_typing_to;

    const { data: presence, error } = await supabase
      .from("user_presence")
      .upsert({ user_id: currentUserId, ...updateData })
      .select("*")
      .maybeSingle();

    if (error) throw error;

    // Broadcast presence to everyone (authenticated users)
    broadcastRealtime({
      type: "presence_updated",
      data: presence,
    });

    res.json({ success: true, data: presence });
  } catch (error) {
    next(error);
  }
};
