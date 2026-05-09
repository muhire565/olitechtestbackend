require('dotenv').config();
const { supabase } = require("../src/config/supabase");

async function simulateGetContacts() {
  const currentUserId = '8c95e63d-4e9a-4c94-9581-e016d536688a'; // OlitechHub
  console.log(`Simulating getContacts for ${currentUserId}...`);

  const { data: users, error: usersError } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active")
    .neq("id", currentUserId)
    .eq("is_active", true);

  if (usersError) {
    console.error("USERS FETCH ERROR:", usersError);
    return;
  }

  console.log(`Found ${users.length} other active users.`);

  const contacts = await Promise.all(
    users.map(async (user) => {
      try {
        const { data: lastMsg, error: lastMsgError } = await supabase
          .from("messages")
          .select("*")
          .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${user.id}),and(sender_id.eq.${user.id},receiver_id.eq.${currentUserId})`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastMsgError) throw lastMsgError;

        const { count: unreadCount, error: unreadError } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("sender_id", user.id)
          .eq("receiver_id", currentUserId)
          .eq("is_read", false);

        if (unreadError) throw unreadError;

        return {
          ...user,
          last_message: lastMsg || null,
          unread_count: unreadCount || 0,
        };
      } catch (err) {
        console.error(`Error for user ${user.id}:`, err.message);
        throw err;
      }
    })
  );

  console.log("SUCCESS! Contacts:", contacts);
}

simulateGetContacts();
