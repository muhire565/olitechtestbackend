const express = require("express");
const { allowRoles } = require("../../middleware/rbac");
const c = require("./controller");

const r = express.Router();

// Developer-only management
r.post("/", allowRoles("developer"), c.create);
r.get("/all", allowRoles("developer"), c.listAll);
r.patch("/:id/clear", allowRoles("developer"), c.clear);
r.patch("/:id/restore", allowRoles("developer"), c.restore);
r.delete("/:id", allowRoles("developer"), c.remove);

// Owner + Cashier: read active notifications
r.get("/", allowRoles("owner", "cashier", "developer"), c.listActive);

module.exports = r;
