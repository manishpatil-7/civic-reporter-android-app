import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";
import dns from "dns";
import complaintRoutes from "./routes/complaint.js";
import uploadRoutes from "./routes/upload.js";
import aiRoutes from "./routes/ai.js";
import authorityRoutes from "./routes/authority.js";
import userRoutes from "./routes/users.js";
import notificationRoutes from "./routes/notification.js";
import otpRoutes from "./routes/otp.js";
import locationRoutes from "./routes/location.js";
import duplicateRoutes from "./routes/duplicate.js";

// Load env first
dotenv.config();

dns.setServers(["8.8.8.8", "1.1.1.1"]);

console.log("Starting server...");

// Connect DB
connectDB();

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use("/api/ai", aiRoutes);
app.use("/api/complaints", complaintRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/authority", authorityRoutes);
app.use("/api/users", userRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/location", locationRoutes);
app.use("/api/duplicates", duplicateRoutes);

app.get("/", (req, res) => {
  res.send("🚀 Backend is running...");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});