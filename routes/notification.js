import express from "express";
import Notification from "../models/Notification.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// 🚀 GET ALL NOTIFICATIONS FOR A USER
router.get("/", authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.uid }).sort({ createdAt: -1 }).limit(50);
    const mapped = notifications.map(n => ({ id: n._id, ...n.toJSON() }));
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 🚀 MARK NOTIFICATION AS READ
router.put("/:id/read", authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.uid },
      { read: true },
      { new: true }
    );
    if (!notification) return res.status(404).json({ message: "Not found" });
    res.json({ id: notification._id, ...notification.toJSON() });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 🚀 DELETE NOTIFICATION
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const deleted = await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user.uid });
    if (!deleted) return res.status(404).json({ message: "Not found" });
    res.json({ message: "Notification deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
