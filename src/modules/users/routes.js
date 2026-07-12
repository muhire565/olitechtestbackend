const express = require("express");
const { body } = require("express-validator");
const { allowRoles } = require("../../middleware/rbac");
const { validate } = require("../../utils/http");
const c = require("./controller");

const r = express.Router();
r.get("/", allowRoles("developer"), c.list);
r.post(
  "/",
  allowRoles("developer", "owner"),
  [
    body("email").optional().isEmail(),
    body("username").optional().isLength({ min: 2, max: 64 }),
    body("password").isLength({ min: 6 }),
    body("full_name").notEmpty(),
    body("role").isIn(["owner", "cashier", "developer"]),
    body("pin").optional().matches(/^\d{4,6}$/).withMessage("PIN must be 4 to 6 digits"),
  ],
  (req, res, next) => {
    try { validate(req); } catch (e) { return next(e); }
    c.create(req, res, next);
  }
);
r.get("/:id", allowRoles("developer"), c.getOne);
r.put(
  "/:id",
  allowRoles("developer"),
  [body("full_name").optional().notEmpty(), body("role").optional().isIn(["owner", "cashier", "developer"])],
  (req, res, next) => {
    try { validate(req); } catch (e) { return next(e); }
    c.update(req, res, next);
  }
);
r.patch("/:id/deactivate", allowRoles("developer"), c.deactivate);
r.patch("/:id/reset-password", allowRoles("developer"), [body("email").isEmail()], (req, res, next) => { try { validate(req); } catch (e) { return next(e); } c.resetPassword(req, res, next); });

r.post("/:id/block", allowRoles("developer"), c.block);
r.post("/:id/unblock", allowRoles("developer"), c.unblock);
r.post("/:id/force-logout", allowRoles("developer"), c.forceLogout);

r.patch(
  "/:id/pin",
  allowRoles("developer", "owner"),
  [body("pin").matches(/^\d{4,6}$/).withMessage("PIN must be 4 to 6 digits")],
  (req, res, next) => {
    try { validate(req); } catch (e) { return next(e); }
    c.setPin(req, res, next);
  }
);
r.delete("/:id/pin", allowRoles("developer", "owner"), c.clearPin);

module.exports = r;
