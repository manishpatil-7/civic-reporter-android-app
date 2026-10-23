import express from "express";
import multer from "multer";
import cloudinary from "../config/cloudinary.js";

const router = express.Router();

// store file in memory buffer
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }
});

// POST /api/upload
router.post("/", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided in upload" });
    }

    const b64 = Buffer.from(req.file.buffer).toString("base64");
    const dataURI = `data:${req.file.mimetype || "image/jpeg"};base64,${b64}`;
    const result = await cloudinary.uploader.upload(dataURI, {
      folder: "civic_reports",
      resource_type: "image",
    });

    res.json({
      imageUrl: result.secure_url,
    });
  } catch (error) {
    console.error("Upload endpoint error:", error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;