import express from "express";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";

const router = express.Router();

// store file temporarily
const storage = multer.diskStorage({});
const upload = multer({ storage });

// POST /api/upload
router.post("/", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided in upload" });
    }
    const result = await cloudinary.uploader.upload(req.file.path);

    res.json({
      imageUrl: result.secure_url,
    });
  } catch (error) {
    console.error("Upload endpoint error:", error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;