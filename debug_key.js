require('dotenv').config();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("Key length:", key?.length);
console.log("Segments:", key?.split('.').length);
if (key) {
  const parts = key.split('.');
  parts.forEach((p, i) => console.log(`Part ${i} length:`, p.length));
}
