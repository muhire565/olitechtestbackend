require('dotenv').config();
const { supabase } = require("../src/config/supabase");

async function testOrFilter() {
  const currentUserId = '8c95e63d-4e9a-4c94-9581-e016d536688a'; // OlitechHub
  const userId = '84befeb9-0456-446f-9ed8-72dae2555fa5'; // IrakozeNadia
  
  console.log("Testing .or filter...");
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${currentUserId})`)
    .limit(1);

  if (error) {
    console.error("OR FILTER ERROR:", error.message);
  } else {
    console.log("OR FILTER SUCCESS:", data);
  }
}

testOrFilter();
