const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhbHhyemtzeHBxZ3NuanFsaWFsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njc2MTg2NSwiZXhwIjoyMDkyMzM3ODY1fQ.8vjioo1T4JzoieuQ9BU49yHoSZzMao8u_3u83uuv_HI";
const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString());
console.log(payload);
