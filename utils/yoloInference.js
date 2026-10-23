import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import { INFERENCE_CONFIG } from "../config/inferenceConfig.js";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_SCRIPT_PATH = path.resolve(__dirname, "../inference_service/run_cli.py");

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
  return { online: false, localModels: checkLocalModelsAvailable() };
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
      timeout: INFERENCE_CONFIG.cliTimeoutMs,
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
          const response = await fetch(imageUrl, {
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

    // 3. Run CLI Python script
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
