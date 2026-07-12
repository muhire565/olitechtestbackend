const express = require("express");
const { body } = require("express-validator");
const auth = require("../../middleware/auth");
const { validate } = require("../../utils/http");
const controller = require("./controller");
const { listLoginLogs, deleteLoginLog, clearAllLoginLogs } = require("./loginLogs");

const router = express.Router();

const pinBodyValidator = body("pin")
  .trim()
  .matches(/^\d{4,6}$/)
  .withMessage("PIN must be 4 to 6 digits");

router.post("/login", [body("email").isLength({ min: 2 }), body("password").isLength({ min: 6 })], (req, res, next) => { try { validate(req); } catch (e) { return next(e); } controller.login(req, res, next); });
router.post("/login-pin", [pinBodyValidator], (req, res, next) => { try { validate(req); } catch (e) { return next(e); } controller.loginPin(req, res, next); });
router.post("/logout", controller.logout);
router.post("/refresh", [body("refresh_token").notEmpty()], (req, res, next) => { try { validate(req); } catch (e) { return next(e); } controller.refresh(req, res, next); });
router.get("/me", auth, controller.me);
router.patch(
  "/credentials",
  auth,
  [
    body("current_password").isLength({ min: 6 }),
    body("username").optional().isLength({ min: 2, max: 64 }),
    body("new_password").optional().isLength({ min: 6 }),
  ],
  (req, res, next) => {
    try { validate(req); } catch (e) { return next(e); }
    controller.updateCredentials(req, res, next);
  }
);
router.patch(
  "/pin",
  auth,
  [
    body("current_password").isLength({ min: 6 }),
    pinBodyValidator,
  ],
  (req, res, next) => {
    try { validate(req); } catch (e) { return next(e); }
    controller.setOwnPin(req, res, next);
  }
);
router.delete(
  "/pin",
  auth,
  [body("current_password").isLength({ min: 6 })],
  (req, res, next) => {
    try { validate(req); } catch (e) { return next(e); }
    controller.clearOwnPin(req, res, next);
  }
);

// Developer: login activity log
router.get("/login-logs", auth, listLoginLogs);
router.delete("/login-logs/all", auth, clearAllLoginLogs);
router.delete("/login-logs/:id", auth, deleteLoginLog);

module.exports = router;
