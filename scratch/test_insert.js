require('dotenv').config();
const { supabase } = require("../src/config/supabase");

async function checkMessagesDefinition() {
  console.log("Checking messages table structure...");
  // We can't easily get the table definition via RPC without custom functions,
  // but we can try to insert a row with an explicit ID to see if it works,
  // or just try to insert one without an ID and see what error we get.
  
  const { data, error } = await supabase
    .from("messages")
    .insert([{ 
        sender_id: '8c95e63d-4e9a-4c94-9581-e016d536688a', 
        receiver_id: '84befeb9-0456-446f-9ed8-72dae2555fa5', 
        content: 'Test message', 
        is_read: false 
    }])
    .select("*")
    .single();

  if (error) {
    console.error("INSERT ERROR:", error);
  } else {
    console.log("INSERT SUCCESS:", data);
  }
}

checkMessagesDefinition();
