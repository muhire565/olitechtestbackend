require("dotenv").config();
const { list } = require("../src/modules/customers/controller");

async function testController() {
  const req = { query: { page: 1, limit: 10 } };
  const res = {
    json: (data) => console.log("JSON Response:", JSON.stringify(data, null, 2)),
    status: (code) => {
      console.log("Status:", code);
      return res;
    }
  };
  const next = (err) => console.error("Error in next:", err);

  await list(req, res, next);
}

testController();
