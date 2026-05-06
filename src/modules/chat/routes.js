const express = require("express");
const router = express.Router();
const chatController = require("./controller");

router.get("/contacts", chatController.getContacts);
router.get("/messages/:contactId", chatController.getMessages);
router.post("/messages", chatController.sendMessage);
router.patch("/messages/:contactId/read", chatController.markAsRead);
router.post("/presence", chatController.updatePresence);

module.exports = router;
