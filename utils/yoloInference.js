import fs from "fs";
import path from "path";
import os from "os";
import { execFile, spawn } from "child_process";
import readline from "readline";
import { promisify } from "util";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import { INFERENCE_CONFIG } from "../config/inferenceConfig.js";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_SCRIPT_PATH = path.resolve(__dirname, "../inference_service/run_cli.py");
const WORKER_SCRIPT_PATH = path.resolve(__dirname, "../inference_service/yolo_worker.py");

let workerProcess = null;
let workerReady = false;
const pendingRequests = new Map();
let requestIdCounter = 0;

/**
 * Initializes and manages a persistent in-memory YOLO worker.
 * Eliminates cold-start PyTorch import overhead.
 */
function initWorker() {
  if (workerProcess && !workerProcess.killed) return;

  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  console.log("🚀 Spawning persistent in-memory YOLO worker...");

  try {
    workerProcess = spawn(pythonCmd, ["-u", WORKER_SCRIPT_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const rl = readline.createInterface({
      input: workerProcess.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      try {
        const trimmed = line.trim();
        if (!trimmed) return;
        const data = JSON.parse(trimmed);
        if (data.status === "ready") {
          workerReady = true;
          console.log("✅ Persistent YOLO worker ready in RAM:", data);
          return;
        }
        if (data.id && pendingRequests.has(data.id)) {
          const { resolve } = pendingRequests.get(data.id);
          pendingRequests.delete(data.id);
          resolve(data);
        }
      } catch (e) {
        console.warn("Worker parse line error:", e.message, line.slice(0, 100));
      }
    });

    workerProcess.stderr.on("data", (chunk) => {
      console.log("Worker log:", chunk.toString().trim());
    });

    workerProcess.on("exit", (code, signal) => {
      console.warn(`Worker process exited (code ${code}, signal ${signal})`);
      workerProcess = null;
      workerReady = false;
      for (const [id, { reject }] of pendingRequests.entries()) {
        reject(new Error(`Worker exited before responding to request ${id}`));
      }
      pendingRequests.clear();
    });
  } catch (err) {
    console.error("Failed to spawn YOLO worker:", err.message);
  }
}

/**
 * Executes inference through the persistent in-memory worker.
 */
async function runWorkerInference({ imagePath, modelType, confidenceThreshold }) {
  initWorker();
  const id = `req_${++requestIdCounter}_${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("Worker inference timeout after 30s"));
    }, 30000);

    pendingRequests.set(id, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });

    const payload =
      JSON.stringify({
        id,
        imagePath,
        modelType,
        conf: confidenceThreshold,
      }) + "\n";

    if (workerProcess && workerProcess.stdin.writable) {
      workerProcess.stdin.write(payload);
    } else {
      clearTimeout(timer);
      pendingRequests.delete(id);
      reject(new Error("Worker stdin is not writable"));
    }
  });
}

/**
 * Checks if local weights are present on disk.
 */
export function checkLocalModelsAvailable() {
  const potholeExists = fs.existsSync(INFERENCE_CONFIG.potholeModelPath);
  const garbageExists = fs.existsSync(INFERENCE_CONFIG.garbageModelPath);
  return {
    pothole: potholeExists,
    garbage: garbageExists,
    allReady: potholeExists && garbageExists,
    paths: {
      pothole: INFERENCE_CONFIG.potholeModelPath,
      garbage: INFERENCE_CONFIG.garbageModelPath,
    },
    workerReady,
  };
}

/**
 * Checks if the FastAPI YOLO service is active.
 */
export async function checkYoloServiceHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${INFERENCE_CONFIG.yoloInferenceUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      return { online: true, ...data };
    }
  } catch (err) {
    // Service offline or connection refused
  }
  return { online: false, workerReady, localModels: checkLocalModelsAvailable() };
}

/**
 * Runs YOLO inference via direct CLI python execution.
 */
async function runCliInference({ imagePath, modelType, confidenceThreshold }) {
  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  const args = [
    CLI_SCRIPT_PATH,
    "--image",
    imagePath,
    "--model",
    modelType,
    "--conf",
    String(confidenceThreshold),
    "--pothole-weights",
    INFERENCE_CONFIG.potholeModelPath,
    "--garbage-weights",
    INFERENCE_CONFIG.garbageModelPath,
  ];

  try {
    const { stdout, stderr } = await execFileAsync(pythonCmd, args, {
      timeout: INFERENCE_CONFIG.cliTimeoutMs || 65000,
      maxBuffer: 1024 * 1024 * 10,
    });
    if (stderr) {
      console.log("YOLO CLI stderr:", stderr.trim());
    }
    const trimmed = (stdout || "").trim();
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}") + 1;
    if (jsonStart === -1 || jsonEnd === 0) {
      throw new Error(`CLI output does not contain valid JSON: ${trimmed.slice(0, 200)}`);
    }
    const parsed = JSON.parse(trimmed.substring(jsonStart, jsonEnd));
    return parsed;
  } catch (err) {
    console.error("YOLO CLI execution error:", err.message, err.stderr || "");
    throw err;
  }
}

/**
 * Main inference runner:
 * 1. Attempts HTTP microservice first (fastest, memory resident).
 * 2. Falls back to CLI execution if HTTP service is offline.
 * 3. Returns standard normalized response.
 */
export async function runYoloInference({
  imageUrl = null,
  imagePath = null,
  imageBuffer = null,
  modelType = "both",
  confidenceThreshold = null,
}) {
  const threshold =
    confidenceThreshold !== null && confidenceThreshold !== undefined
      ? confidenceThreshold
      : modelType === "pothole"
      ? INFERENCE_CONFIG.potholeConfidenceThreshold
      : modelType === "garbage"
      ? INFERENCE_CONFIG.garbageConfidenceThreshold
      : Math.min(
          INFERENCE_CONFIG.potholeConfidenceThreshold,
          INFERENCE_CONFIG.garbageConfidenceThreshold
        );

  let tempFilePath = null;

  try {
    // 1. Try FastAPI HTTP Service only if explicitly configured
    if (process.env.USE_YOLO_HTTP === "true" && INFERENCE_CONFIG.yoloInferenceUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), INFERENCE_CONFIG.httpTimeoutMs);

        const formData = new FormData();
        formData.append("model_type", modelType);
        formData.append("confidence_threshold", String(threshold));

        if (imageBuffer) {
          const blob = new Blob([imageBuffer]);
          formData.append("file", blob, "upload.jpg");
        } else if (imageUrl) {
          formData.append("image_url", imageUrl);
        } else if (imagePath) {
          formData.append("image_path", imagePath);
        }

        const res = await fetch(`${INFERENCE_CONFIG.yoloInferenceUrl}/detect`, {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const result = await res.json();
          return result;
        }
      } catch (httpErr) {
        console.log(`⚠️ YOLO HTTP service unavailable (${httpErr.message}). Falling back to local CLI...`);
      }
    }

/**
 * Optimizes Cloudinary or remote image URLs to 640px limit to minimize download latency and RAM.
 */
function getOptimizedImageUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    if (!url.includes("/upload/w_640")) {
      return url.replace("/upload/", "/upload/w_640,c_limit,q_80/");
    }
  }
  return url;
}

    // 2. Prepare local file for CLI runner
    let resolvedPath = imagePath;
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      if (imageUrl && (imageUrl.startsWith("file://") || fs.existsSync(imageUrl))) {
        resolvedPath = imageUrl.startsWith("file://") ? fileURLToPath(imageUrl) : imageUrl;
      } else {
        tempFilePath = path.join(os.tmpdir(), `yolo_input_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`);
        if (imageBuffer) {
          await fs.promises.writeFile(tempFilePath, imageBuffer);
        } else if (imageUrl) {
          const downloadUrl = getOptimizedImageUrl(imageUrl);
          const response = await fetch(downloadUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
          });
          if (!response.ok) {
            throw new Error(`Failed to download image from URL (${response.status} ${response.statusText}): ${imageUrl}`);
          }
          const arrayBuf = await response.arrayBuffer();
          await fs.promises.writeFile(tempFilePath, Buffer.from(arrayBuf));
        } else {
          throw new Error("No valid image source (URL, path, or buffer) provided for YOLO inference.");
        }
        resolvedPath = tempFilePath;
      }
    }

    // 3. Run Inference: Try persistent in-memory worker first (~300ms warm execution)
    try {
      const workerRes = await runWorkerInference({
        imagePath: resolvedPath,
        modelType,
        confidenceThreshold: threshold,
      });
      if (workerRes && workerRes.success) {
        return workerRes;
      }
    } catch (workerErr) {
      console.warn(`Persistent worker execution deferred (${workerErr.message}). Running CLI runner...`);
    }

    // 4. Fallback: Run direct CLI Python script
    const cliResult = await runCliInference({
      imagePath: resolvedPath,
      modelType,
      confidenceThreshold: threshold,
    });

    return cliResult;
  } catch (error) {
    console.error("YOLO Inference failed completely:", error.message);
    return {
      success: false,
      error: error.message,
      model: "none",
      detectionCount: 0,
      maxConfidence: 0.0,
      detections: [],
      analysisProvider: "yolo",
      canReportManually: true,
    };
  } finally {
    // Clean up temporary image file if created
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        await fs.promises.unlink(tempFilePath);
      } catch (cleanupErr) {
        // non-blocking
      }
    }
  }
}

export default {
  runYoloInference,
  checkYoloServiceHealth,
  checkLocalModelsAvailable,
};
