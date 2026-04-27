const express = require("express");
const { body } = require("express-validator");
const auth = require("../../middleware/auth");
const { validate } = require("../../utils/http");
const controller = require("./controller");
const { listLoginLogs } = require("./loginLogs");

const router = express.Router();

router.post("/login", [body("email").isLength({ min: 2 }), body("password").isLength({ min: 6 })], (req, res, next) => { try { validate(req); } catch (e) { return next(e); } controller.login(req, res, next); });
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

// Developer: login activity log
router.get("/login-logs", auth, listLoginLogs);

module.exports = router;
