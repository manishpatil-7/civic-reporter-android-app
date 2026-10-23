import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const INFERENCE_CONFIG = {
  // Service URLs
  yoloInferenceUrl: process.env.YOLO_INFERENCE_URL || "http://127.0.0.1:8000",
  
  // Model weights filesystem paths
  potholeModelPath: process.env.POTHOLE_MODEL_PATH || path.resolve(__dirname, "../models/pothole_best.pt"),
  garbageModelPath: process.env.GARBAGE_MODEL_PATH || path.resolve(__dirname, "../models/garbage_best.pt"),
  
  // Detection Confidence Thresholds (Optimized for real-world citizen smartphone photos)
  potholeConfidenceThreshold: parseFloat(process.env.POTHOLE_CONFIDENCE_THRESHOLD || "0.10"),
  garbageConfidenceThreshold: parseFloat(process.env.GARBAGE_CONFIDENCE_THRESHOLD || "0.10"),
  
  // High confidence threshold for automatic acceptance without Gemini
  highConfidenceThreshold: 0.20,

  // Timeouts (milliseconds)
  httpTimeoutMs: 1000,
  cliTimeoutMs: 65000,
  
  // Supported issue categories
  categories: {
    ROAD_DAMAGE: "pothole",
    GARBAGE: "garbage",
    STREETLIGHT: "streetlight",
    DRAINAGE: "drainage",
    OTHER: "other"
  }
};

export default INFERENCE_CONFIG;
