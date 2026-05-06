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
          .single();

        // Unread count
        const { count: unreadCount } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("sender_id", user.id)
          .eq("receiver_id", currentUserId)
          .eq("is_read", false);

        // Presence
        const { data: presence } = await supabase
          .from("user_presence")
          .select("is_online, last_seen")
          .eq("user_id", user.id)
          .single();

        return {
          ...user,
          last_message: lastMsg || null,
          unread_count: unreadCount || 0,
          presence: presence || { is_online: false, last_seen: null },
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

    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${contactId}),and(sender_id.eq.${contactId},receiver_id.eq.${currentUserId})`)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json({ success: true, data: messages });
  } catch (error) {
    next(error);
  }
};

exports.sendMessage = async (req, res, next) => {
  try {
    const { id: currentUserId } = req.user;
    const { receiver_id, content } = req.body;

    const { data: message, error } = await supabase
      .from("messages")
      .insert([{ sender_id: currentUserId, receiver_id, content, is_read: false }])
      .select("*")
      .single();

    if (error) throw error;

    // Broadcast via WebSocket
    broadcastRealtime({
      type: "new_message",
      data: message,
    });

    res.status(201).json({ success: true, data: message });
  } catch (error) {
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

    // Broadcast via WebSocket
    broadcastRealtime({
      type: "messages_read",
      data: {
        reader_id: currentUserId,
        sender_id: contactId,
      },
    });

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
      .single();

    if (error) throw error;

    // Broadcast via WebSocket
    broadcastRealtime({
      type: "presence_updated",
      data: presence,
    });

    res.json({ success: true, data: presence });
  } catch (error) {
    next(error);
  }
};
