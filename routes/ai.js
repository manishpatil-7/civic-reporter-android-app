import express from "express";
import multer from "multer";
import fs from "fs";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from "node-fetch";
import { supportedLanguages } from "../data/authorityData.js";
import { INFERENCE_CONFIG } from "../config/inferenceConfig.js";
import {
  runYoloInference,
  checkYoloServiceHealth,
  checkLocalModelsAvailable,
} from "../utils/yoloInference.js";
import {
  generateDeterministicLetter,
  getTemplateType,
  TEMPLATE_TYPES,
} from "../utils/complaintTemplates.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const router = express.Router();
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } });

// ===================================================
// GOOGLE GEMINI CLIENT CONFIGURATION
// ===================================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const safetySettings = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

const jsonModelConfig = {
  model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
  generationConfig: {
    temperature: 0.1,
    maxOutputTokens: 2048,
    responseMimeType: "application/json",
  },
  safetySettings,
};

const textModelConfig = {
  model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
  generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 4096,
  },
  safetySettings,
};

let visionModel, translationModel;
try {
  visionModel = genAI.getGenerativeModel(jsonModelConfig);
  translationModel = genAI.getGenerativeModel(textModelConfig);
  console.log("✅ Gemini models initialized (JSON Vision + Text Translation)");
} catch (err) {
  console.error("❌ Failed to initialize Gemini models:", err.message);
}

/**
 * Downloads image from URL and converts to base64 buffer for Gemini
 */
async function fetchImageBase64(imageUrl) {
  if (imageUrl.startsWith("file://") || fs.existsSync(imageUrl)) {
    const filePath = imageUrl.startsWith("file://") ? fileURLToPath(imageUrl) : imageUrl;
    const buffer = await fs.promises.readFile(filePath);
    return {
      base64Image: buffer.toString("base64"),
      mimeType: "image/jpeg",
    };
  }
  const imgResponse = await fetch(imageUrl);
  if (!imgResponse.ok) {
    throw new Error(`Failed to fetch image: ${imgResponse.statusText}`);
  }
  const arrayBuffer = await imgResponse.arrayBuffer();
  const base64Image = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = imgResponse.headers.get("content-type") || "image/jpeg";
  return { base64Image, mimeType };
}

/**
 * Safe caller for Gemini Vision with exponential backoff on 429/quota
 */
async function callGeminiVision(base64Image, mimeType, promptText) {
  if (!visionModel) {
    throw new Error("Gemini Vision model is not initialized.");
  }

  let lastError;
  for (let i = 0; i < 3; i++) {
    try {
      const result = await visionModel.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Image,
                },
              },
              {
                text: promptText,
              },
            ],
          },
        ],
      });

      const response = await result.response;
      const rawText = response.text();
      const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}") + 1;
      return JSON.parse(cleaned.substring(jsonStart, jsonEnd));
    } catch (err) {
      lastError = err;
      const msg = err.message || "";
      const isQuotaError =
        msg.includes("429") ||
        msg.includes("quota") ||
        msg.includes("rate") ||
        msg.includes("Please retry");
      const isAccessDenied =
        msg.includes("403") ||
        msg.includes("Forbidden") ||
        msg.includes("denied access") ||
        msg.includes("PERMISSION_DENIED");

      if ((isQuotaError || isAccessDenied) && i < 2) {
        const delay = Math.pow(2, i) * 3000;
        console.log(`⏳ Gemini rate limited. Waiting ${delay}ms before retry...`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
  throw lastError || new Error("Failed to receive valid response from Gemini.");
}

/**
 * Helper to normalize problem type to match Android / Web schemas
 */
function normalizeProblemType(rawType) {
  if (!rawType || rawType === "None") return "Other";
  const t = rawType.toLowerCase();
  if (t.includes("pothole") || t.includes("road")) return "Pothole";
  if (t.includes("garbage") || t.includes("waste")) return "Garbage Dump";
  if (t.includes("light") || t.includes("streetlight")) return "Streetlight Fault";
  if (t.includes("drain") || t.includes("flood") || t.includes("sewer")) return "Broken Drainage";
  if (t.includes("water")) return "Water Leakage";
  if (t.includes("tree")) return "Fallen Tree";
  return "Other";
}

/**
 * Deterministic severity calculator for YOLO detections
 */
function calculateYoloSeverity(detectionCount, maxConfidence) {
  if (detectionCount >= 3 || maxConfidence >= 0.65) return "High";
  if (detectionCount >= 2 || maxConfidence >= 0.38) return "Medium";
  return "Low";
}

// ===================================================
// SYSTEM STATUS ENDPOINT
// ===================================================
router.get("/status", async (req, res) => {
  try {
    const localModels = checkLocalModelsAvailable();
    const serviceHealth = await checkYoloServiceHealth();

    res.json({
      status: "online",
      architecture: "YOLO-First with Gemini Vision Fallback",
      yoloModels: {
        pothole_best: {
          available: localModels.pothole,
          threshold: INFERENCE_CONFIG.potholeConfidenceThreshold,
        },
        garbage_best: {
          available: localModels.garbage,
          threshold: INFERENCE_CONFIG.garbageConfidenceThreshold,
        },
      },
      inferenceService: {
        httpServiceActive: serviceHealth.online,
        cliFallbackReady: true,
      },
      geminiVision: {
        ready: !!visionModel,
        primaryFor: ["streetlight"],
        fallbackFor: ["pothole", "garbage", "unidentified"],
      },
      translation: {
        ready: !!translationModel,
        languagesCount: supportedLanguages.length,
      },
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// ===================================================
// MAIN ANALYZE ENDPOINT (YOLO-FIRST + GEMINI FALLBACK)
// ===================================================
router.post("/analyze", async (req, res) => {
  try {
    const {
      imageUrl,
      userName = "Concerned Citizen",
      locationAddress = "",
      authorityInfo = null,
      category = "",
      problemType = "",
    } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ message: "Image URL required" });
    }

    const selectedCategory = (category || "").toLowerCase();
    const selectedProblemType = (problemType || "").toLowerCase();

    const isRoadDamage =
      selectedCategory.includes("pothole") ||
      selectedCategory.includes("road") ||
      selectedProblemType.includes("pothole");

    const isGarbage =
      selectedCategory.includes("garbage") ||
      selectedCategory.includes("waste") ||
      selectedProblemType.includes("garbage");

    const isStreetlight =
      selectedCategory.includes("street light") ||
      selectedCategory.includes("streetlight") ||
      selectedCategory.includes("light") ||
      selectedCategory.includes("electricity") ||
      selectedProblemType.includes("streetlight") ||
      selectedProblemType.includes("light");

    // ==============================================================
    // ROUTE 1: ROAD DAMAGE / POTHOLE (YOLO11n pothole_best.pt First)
    // ==============================================================
    if (isRoadDamage) {
      console.log("🛣️ Routing image to local YOLO model: pothole_best.pt");
      const yoloResult = await runYoloInference({
        imageUrl,
        modelType: "pothole",
        confidenceThreshold: INFERENCE_CONFIG.potholeConfidenceThreshold,
      });

      const isConfidentYolo =
        yoloResult.success &&
        yoloResult.detectionCount > 0 &&
        yoloResult.maxConfidence >= INFERENCE_CONFIG.potholeConfidenceThreshold;

      if (isConfidentYolo) {
        console.log(
          `✅ YOLO pothole detection confirmed (${yoloResult.detectionCount} detections, max conf: ${yoloResult.maxConfidence}). Skipping Gemini.`
        );

        const severity = calculateYoloSeverity(yoloResult.detectionCount, yoloResult.maxConfidence);
        const resolvedType = "Pothole";

        // Deterministic Letter Generation (Section 8)
        const formalLetter = generateDeterministicLetter({
          templateType: TEMPLATE_TYPES.ROAD_DAMAGE,
          userName,
          locationAddress,
          authorityInfo,
          problemType: resolvedType,
          detectionCount: yoloResult.detectionCount,
          severity,
        });

        return res.json({
          success: true,
          imageUrl,
          problemType: resolvedType,
          severity,
          confidence: yoloResult.maxConfidence,
          description: `Verified road surface deterioration with ${yoloResult.detectionCount} prominent pothole depression(s) detected.`,
          formalLetter,
          priority: severity === "High" ? 30 : severity === "Medium" ? 20 : 10,
          analysisProvider: "yolo",
          geminiFallback: false,
          model: "pothole_best",
          detectionCount: yoloResult.detectionCount,
          detections: yoloResult.detections,
          imageValidation: {
            isValid: true,
            reason: `Local YOLO scan confirmed road damage with ${yoloResult.detectionCount} detection(s).`,
            detectedContent: "pothole / asphalt damage",
          },
          canReportManually: true,
        });
      }

      // Fallback to Gemini Vision if YOLO was uncertain, empty, or failed
      const fallbackReason = !yoloResult.success
        ? "model_unavailable"
        : yoloResult.detectionCount === 0
        ? "no_detections"
        : "low_confidence";

      console.log(`⚠️ YOLO pothole scan uncertain (${fallbackReason}). Invoking Gemini Vision fallback...`);
      return await handleGeminiCivicFallback({
        imageUrl,
        userName,
        locationAddress,
        authorityInfo,
        fallbackReason,
        expectedCategory: "pothole",
        res,
      });
    }

    // ==============================================================
    // ROUTE 2: GARBAGE / WASTE (YOLO11n garbage_best.pt First)
    // ==============================================================
    if (isGarbage) {
      console.log("🗑️ Routing image to local YOLO model: garbage_best.pt");
      const yoloResult = await runYoloInference({
        imageUrl,
        modelType: "garbage",
        confidenceThreshold: INFERENCE_CONFIG.garbageConfidenceThreshold,
      });

      const isConfidentYolo =
        yoloResult.success &&
        yoloResult.detectionCount > 0 &&
        yoloResult.maxConfidence >= INFERENCE_CONFIG.garbageConfidenceThreshold;

      if (isConfidentYolo) {
        console.log(
          `✅ YOLO garbage detection confirmed (${yoloResult.detectionCount} detections, max conf: ${yoloResult.maxConfidence}). Skipping Gemini.`
        );

        const severity = calculateYoloSeverity(yoloResult.detectionCount, yoloResult.maxConfidence);
        const resolvedType = "Garbage Dump";

        // Deterministic Letter Generation (Section 8)
        const formalLetter = generateDeterministicLetter({
          templateType: TEMPLATE_TYPES.GARBAGE,
          userName,
          locationAddress,
          authorityInfo,
          problemType: resolvedType,
          detectionCount: yoloResult.detectionCount,
          severity,
        });

        return res.json({
          success: true,
          imageUrl,
          problemType: resolvedType,
          severity,
          confidence: yoloResult.maxConfidence,
          description: `Verified solid waste accumulation with ${yoloResult.detectionCount} dump cluster(s) detected.`,
          formalLetter,
          priority: severity === "High" ? 30 : severity === "Medium" ? 20 : 10,
          analysisProvider: "yolo",
          geminiFallback: false,
          model: "garbage_best",
          detectionCount: yoloResult.detectionCount,
          detections: yoloResult.detections,
          imageValidation: {
            isValid: true,
            reason: `Local YOLO scan confirmed garbage accumulation with ${yoloResult.detectionCount} detection(s).`,
            detectedContent: "solid waste / garbage accumulation",
          },
          canReportManually: true,
        });
      }

      const fallbackReason = !yoloResult.success
        ? "model_unavailable"
        : yoloResult.detectionCount === 0
        ? "no_detections"
        : "low_confidence";

      console.log(`⚠️ YOLO garbage scan uncertain (${fallbackReason}). Invoking Gemini Vision fallback...`);
      return await handleGeminiCivicFallback({
        imageUrl,
        userName,
        locationAddress,
        authorityInfo,
        fallbackReason,
        expectedCategory: "garbage",
        res,
      });
    }

    // ==============================================================
    // ROUTE 3: STREETLIGHT (Gemini Vision Primary Service)
    // ==============================================================
    if (isStreetlight) {
      console.log("💡 Routing image to Gemini Vision Primary Service for Streetlight Inspection");
      return await handleStreetlightGeminiPrimary({
        imageUrl,
        userName,
        locationAddress,
        authorityInfo,
        res,
      });
    }

    // ==============================================================
    // ROUTE 4: UNSELECTED / UNIDENTIFIED CATEGORY
    // ==============================================================
    console.log("🔍 Category unselected. Running both local YOLO models first...");
    const multiYolo = await runYoloInference({
      imageUrl,
      modelType: "both",
      confidenceThreshold: Math.min(
        INFERENCE_CONFIG.potholeConfidenceThreshold,
        INFERENCE_CONFIG.garbageConfidenceThreshold
      ),
    });

    // Check if either local model produced a confident hit
    const potholeHits = multiYolo.allDetections?.pothole || [];
    const garbageHits = multiYolo.allDetections?.garbage || [];

    const bestPotholeConf = potholeHits.length > 0 ? potholeHits[0].confidence : 0;
    const bestGarbageConf = garbageHits.length > 0 ? garbageHits[0].confidence : 0;

    if (
      bestPotholeConf >= INFERENCE_CONFIG.potholeConfidenceThreshold &&
      bestPotholeConf >= bestGarbageConf
    ) {
      console.log(`✅ Unselected category classified as Road Damage via YOLO (conf: ${bestPotholeConf})`);
      const severity = calculateYoloSeverity(potholeHits.length, bestPotholeConf);
      const formalLetter = generateDeterministicLetter({
        templateType: TEMPLATE_TYPES.ROAD_DAMAGE,
        userName,
        locationAddress,
        authorityInfo,
        problemType: "Pothole",
        detectionCount: potholeHits.length,
        severity,
      });

      return res.json({
        success: true,
        imageUrl,
        problemType: "Pothole",
        severity,
        confidence: bestPotholeConf,
        description: `Automated scan identified road damage with ${potholeHits.length} pothole(s).`,
        formalLetter,
        priority: severity === "High" ? 30 : 20,
        analysisProvider: "yolo",
        geminiFallback: false,
        model: "pothole_best",
        detectionCount: potholeHits.length,
        detections: potholeHits,
        imageValidation: {
          isValid: true,
          reason: "Classified as road damage by local YOLO detector.",
          detectedContent: "pothole",
        },
        canReportManually: true,
      });
    }

    if (bestGarbageConf >= INFERENCE_CONFIG.garbageConfidenceThreshold) {
      console.log(`✅ Unselected category classified as Garbage Dump via YOLO (conf: ${bestGarbageConf})`);
      const severity = calculateYoloSeverity(garbageHits.length, bestGarbageConf);
      const formalLetter = generateDeterministicLetter({
        templateType: TEMPLATE_TYPES.GARBAGE,
        userName,
        locationAddress,
        authorityInfo,
        problemType: "Garbage Dump",
        detectionCount: garbageHits.length,
        severity,
      });

      return res.json({
        success: true,
        imageUrl,
        problemType: "Garbage Dump",
        severity,
        confidence: bestGarbageConf,
        description: `Automated scan identified uncollected solid waste accumulation with ${garbageHits.length} dump site(s).`,
        formalLetter,
        priority: severity === "High" ? 30 : 20,
        analysisProvider: "yolo",
        geminiFallback: false,
        model: "garbage_best",
        detectionCount: garbageHits.length,
        detections: garbageHits,
        imageValidation: {
          isValid: true,
          reason: "Classified as garbage accumulation by local YOLO detector.",
          detectedContent: "garbage dump",
        },
        canReportManually: true,
      });
    }

    // Neither local model yielded a confident match -> Gemini fallback to identify issue or reject
    console.log("⚠️ No local model matches. Invoking Gemini Vision to identify civic issue or reject...");
    return await handleGeminiCivicFallback({
      imageUrl,
      userName,
      locationAddress,
      authorityInfo,
      fallbackReason: "category_classification",
      expectedCategory: null,
      res,
    });
  } catch (error) {
    console.error("General AI Analyze Error:", error.message);
    const fallbackLetter = generateDeterministicLetter({
      templateType: TEMPLATE_TYPES.GENERAL,
      userName: req.body?.userName || "Concerned Citizen",
      locationAddress: req.body?.locationAddress || "",
      authorityInfo: req.body?.authorityInfo,
      problemType: "Civic Infrastructure Defect",
      severity: "Medium",
    });

    return res.json({
      problemType: "Other",
      severity: "Medium",
      description: "AI analysis temporarily unavailable. Issue details have been initialized for manual verification.",
      formalLetter: fallbackLetter,
      confidence: 0.6,
      priority: 20,
      analysisProvider: "gemini",
      geminiFallback: true,
      fallbackReason: "service_error",
      imageValidation: {
        isValid: true,
        reason: "Analysis service error — manual reporting permitted",
        detectedContent: "unknown",
      },
      canReportManually: true,
    });
  }
});

/**
 * Streetlight Primary Analysis using Gemini Vision
 * Enforces strict physical damage checks (broken fixture, bent pole, hanging wires)
 * explicitly avoiding assuming an electrical fault solely because lamp is unlit in daytime.
 */
async function handleStreetlightGeminiPrimary({
  imageUrl,
  userName,
  locationAddress,
  authorityInfo,
  res,
}) {
  try {
    const { base64Image, mimeType } = await fetchImageBase64(imageUrl);

    const promptText = `You are a professional municipal electrical & public works infrastructure inspector.
Analyze this image of a public streetlight, lamp post, or lighting installation.

CRITICAL PHYSICAL INSPECTION REQUIREMENTS:
1. Assess VISIBLE PHYSICAL DAMAGE to the fixture:
   - Broken, cracked, or shattered lamp glass/fixture
   - Bent, tilted, fractured, or fallen poles
   - Missing or detached lamp heads / luminaires
   - Exposed, dangling, or severed electrical wiring
   - Severe corrosion, rust, or vehicular collision impact at the pole base
2. IMPORTANT ELECTRICAL CONSERVATISM RULE:
   - Do NOT infer that a streetlight's electrical system is faulty solely because the lamp appears switched off during daytime or nighttime photos.
   - If the lamp is unlit during daylight hours but has NO visible physical defects, note this explicitly.

Return strictly valid JSON:
{
  "imageValidation": {
    "isValid": true/false,
    "reason": "<explanation of what is visible>",
    "detectedContent": "<e.g. damaged streetlight pole, daytime unlit lamp, non-civic item>"
  },
  "physicalDamageDetected": true/false,
  "detectedDefects": ["<defect 1>", "<defect 2>"],
  "problemType": "Streetlight Fault" or "None",
  "severity": "low" | "medium" | "high",
  "confidence": <0 to 100>,
  "description": "<detailed technical description of visible condition>",
  "isDaytimeUnlitOnly": true/false
}`;

    const geminiData = await callGeminiVision(base64Image, mimeType, promptText);

    // If image is unrelated to streetlights or civic issues
    if (geminiData.imageValidation && !geminiData.imageValidation.isValid) {
      return res.json({
        imageUrl,
        problemType: "None",
        severity: "Low",
        confidence: 0,
        description: geminiData.description || "No visible streetlight damage detected.",
        formalLetter: "",
        priority: 0,
        analysisProvider: "gemini",
        geminiFallback: false,
        imageValidation: geminiData.imageValidation,
        canReportManually: true,
      });
    }

    const normConfidence =
      geminiData.confidence > 1 ? geminiData.confidence / 100 : geminiData.confidence || 0.8;
    const severity =
      geminiData.severity === "high" ? "High" : geminiData.severity === "low" ? "Low" : "Medium";
    const detectedDefects = geminiData.detectedDefects || [];

    // Deterministic Letter Generation (Section 8)
    const formalLetter = generateDeterministicLetter({
      templateType: TEMPLATE_TYPES.STREETLIGHT,
      userName,
      locationAddress,
      authorityInfo,
      problemType: "Streetlight Fault",
      severity,
      detectedDefects,
    });

    return res.json({
      success: true,
      imageUrl,
      problemType: "Streetlight Fault",
      severity,
      confidence: normConfidence,
      description:
        geminiData.description ||
        `Streetlight infrastructure defect reported with physical defects: ${
          detectedDefects.join(", ") || "structural damage to luminaire"
        }.`,
      formalLetter,
      priority: severity === "High" ? 30 : severity === "Medium" ? 20 : 10,
      analysisProvider: "gemini",
      geminiFallback: false,
      detectedDefects,
      physicalDamageDetected: geminiData.physicalDamageDetected ?? true,
      isDaytimeUnlitOnly: geminiData.isDaytimeUnlitOnly ?? false,
      imageValidation: geminiData.imageValidation || {
        isValid: true,
        reason: "Verified streetlight infrastructure",
        detectedContent: "Streetlight fixture",
      },
      canReportManually: true,
    });
  } catch (error) {
    console.error("Gemini Streetlight Analysis Error:", error.message);
    const formalLetter = generateDeterministicLetter({
      templateType: TEMPLATE_TYPES.STREETLIGHT,
      userName,
      locationAddress,
      authorityInfo,
      problemType: "Streetlight Fault",
      severity: "Medium",
    });

    return res.json({
      problemType: "Streetlight Fault",
      severity: "Medium",
      confidence: 0.7,
      description: "Streetlight fault reported. Physical inspection recommended.",
      formalLetter,
      priority: 20,
      analysisProvider: "gemini",
      geminiFallback: false,
      imageValidation: {
        isValid: true,
        reason: "Inspection initialised — manual verification enabled",
        detectedContent: "Streetlight",
      },
      canReportManually: true,
    });
  }
}

/**
 * General Civic Fallback Handler using Gemini Vision
 * Triggered only when YOLO models fail, produce uncertain confidence, or for unselected categories.
 */
async function handleGeminiCivicFallback({
  imageUrl,
  userName,
  locationAddress,
  authorityInfo,
  fallbackReason,
  expectedCategory,
  res,
}) {
  try {
    const { base64Image, mimeType } = await fetchImageBase64(imageUrl);

    const promptText = `You are a civic infrastructure inspection AI with IMAGE VALIDATION capabilities.

Determine whether this image shows a real civic/infrastructure maintenance issue or is non-civic/unrelated.

NON-CIVIC (INVALID) images:
- Selfies, personal photos, group portraits
- Food, dishes, restaurant settings
- Laptops, computers, screens, documents, certificates
- Pets, indoor domestic animals, houseplants
- Memes, artwork, cartoons, digital graphics
- Vehicle interiors, dashboard cameras showing clear road with no defects

VALID CIVIC ISSUES (pick closest):
- "pothole" = road damage, asphalt crater, broken pavement
- "garbage" = solid waste accumulation, uncollected trash, dump pile
- "streetlight" = damaged street light fixture, bent pole, exposed wiring
- "drainage" = blocked drain, sewer leakage, waterlogging
- "other" = any other civic infrastructure issue (damaged bench, public toilet, broken railing, fallen tree)
- "None" = image is NOT a civic issue

Return strictly valid JSON:
{
  "imageValidation": {
    "isValid": true/false,
    "reason": "<concise explanation>",
    "detectedContent": "<what is visible in the photo>"
  },
  "problemType": "<pothole|garbage|streetlight|drainage|other|None>",
  "severity": "low" | "medium" | "high",
  "confidence": <0 to 100>,
  "description": "<2-3 line objective description of the issue>"
}`;

    const geminiData = await callGeminiVision(base64Image, mimeType, promptText);

    // Rejection handling if image is not a civic issue
    if (geminiData.imageValidation && !geminiData.imageValidation.isValid) {
      return res.json({
        imageUrl,
        problemType: "None",
        severity: "Low",
        confidence: 0,
        description: "No recognized civic infrastructure defect identified in this photograph.",
        formalLetter: "",
        priority: 0,
        analysisProvider: "gemini",
        geminiFallback: true,
        fallbackReason,
        imageValidation: geminiData.imageValidation,
        canReportManually: true,
      });
    }

    const normType = normalizeProblemType(geminiData.problemType);
    const templateType = getTemplateType(normType);
    const severity =
      geminiData.severity === "high" ? "High" : geminiData.severity === "low" ? "Low" : "Medium";
    const confidence =
      geminiData.confidence > 1 ? geminiData.confidence / 100 : geminiData.confidence || 0.75;

    // Generate letter deterministically (Section 8)
    const formalLetter = generateDeterministicLetter({
      templateType,
      userName,
      locationAddress,
      authorityInfo,
      problemType: normType,
      severity,
    });

    return res.json({
      success: true,
      imageUrl,
      problemType: normType,
      severity,
      confidence,
      description:
        geminiData.description || `Reported ${normType} issue at ${locationAddress || "specified location"}.`,
      formalLetter,
      priority: severity === "High" ? 30 : severity === "Medium" ? 20 : 10,
      analysisProvider: "gemini",
      geminiFallback: true,
      fallbackReason,
      imageValidation: geminiData.imageValidation || {
        isValid: true,
        reason: "Verified via Gemini Vision fallback inspection.",
        detectedContent: normType,
      },
      canReportManually: true,
    });
  } catch (error) {
    console.error("Gemini Civic Fallback Error:", error.message);
    const resolvedType = expectedCategory ? normalizeProblemType(expectedCategory) : "Other";
    const formalLetter = generateDeterministicLetter({
      templateType: getTemplateType(resolvedType),
      userName,
      locationAddress,
      authorityInfo,
      problemType: resolvedType,
      severity: "Medium",
    });

    return res.json({
      problemType: resolvedType,
      severity: "Medium",
      description: "AI analysis encountered an error. Issue template initialized for manual review.",
      formalLetter,
      confidence: 0.6,
      priority: 20,
      analysisProvider: "gemini",
      geminiFallback: true,
      fallbackReason: "service_error",
      imageValidation: {
        isValid: true,
        reason: "Service error — manual reporting permitted",
        detectedContent: "unknown",
      },
      canReportManually: true,
    });
  }
}

// ===================================================
// DEDICATED ROAD DAMAGE DETECTION ENDPOINT
// ===================================================
router.post("/road-damage/detect", upload.single("image"), async (req, res) => {
  try {
    let imageUrl = req.body?.imageUrl;
    let imageBuffer = req.file?.buffer;

    if (!imageUrl && !imageBuffer) {
      return res.status(400).json({ message: "Either image file or imageUrl is required." });
    }

    const confThreshold = req.body?.confidence
      ? parseFloat(req.body.confidence)
      : INFERENCE_CONFIG.potholeConfidenceThreshold;

    const yoloRes = await runYoloInference({
      imageUrl,
      imageBuffer,
      modelType: "pothole",
      confidenceThreshold: confThreshold,
    });

    if (yoloRes.success && yoloRes.detectionCount > 0 && yoloRes.maxConfidence >= confThreshold) {
      const severity = calculateYoloSeverity(yoloRes.detectionCount, yoloRes.maxConfidence);
      const formalLetter = generateDeterministicLetter({
        templateType: TEMPLATE_TYPES.ROAD_DAMAGE,
        userName: req.body?.userName || "Concerned Citizen",
        locationAddress: req.body?.locationAddress || "",
        authorityInfo: req.body?.authorityInfo,
        problemType: "Pothole",
        detectionCount: yoloRes.detectionCount,
        severity,
      });

      return res.json({
        success: true,
        problemType: "Pothole",
        severity,
        confidence: yoloRes.maxConfidence,
        description: `Verified road surface deterioration with ${yoloRes.detectionCount} prominent pothole depression(s) detected.`,
        formalLetter,
        analysisProvider: "yolo",
        geminiFallback: false,
        model: "pothole_best",
        detections: yoloRes.detections,
        detectionCount: yoloRes.detectionCount,
      });
    }

    // Fallback if low confidence or no detections
    return await handleGeminiCivicFallback({
      imageUrl: imageUrl || "data:image/jpeg;base64," + imageBuffer.toString("base64"),
      userName: req.body?.userName,
      locationAddress: req.body?.locationAddress,
      authorityInfo: req.body?.authorityInfo,
      fallbackReason: yoloRes.detectionCount === 0 ? "no_detections" : "low_confidence",
      expectedCategory: "pothole",
      res,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================================================
// DEDICATED GARBAGE DETECTION ENDPOINT
// ===================================================
router.post("/garbage/detect", upload.single("image"), async (req, res) => {
  try {
    let imageUrl = req.body?.imageUrl;
    let imageBuffer = req.file?.buffer;

    if (!imageUrl && !imageBuffer) {
      return res.status(400).json({ message: "Either image file or imageUrl is required." });
    }

    const confThreshold = req.body?.confidence
      ? parseFloat(req.body.confidence)
      : INFERENCE_CONFIG.garbageConfidenceThreshold;

    const yoloRes = await runYoloInference({
      imageUrl,
      imageBuffer,
      modelType: "garbage",
      confidenceThreshold: confThreshold,
    });

    if (yoloRes.success && yoloRes.detectionCount > 0 && yoloRes.maxConfidence >= confThreshold) {
      const severity = calculateYoloSeverity(yoloRes.detectionCount, yoloRes.maxConfidence);
      const formalLetter = generateDeterministicLetter({
        templateType: TEMPLATE_TYPES.GARBAGE,
        userName: req.body?.userName || "Concerned Citizen",
        locationAddress: req.body?.locationAddress || "",
        authorityInfo: req.body?.authorityInfo,
        problemType: "Garbage Dump",
        detectionCount: yoloRes.detectionCount,
        severity,
      });

      return res.json({
        success: true,
        problemType: "Garbage Dump",
        severity,
        confidence: yoloRes.maxConfidence,
        description: `Verified solid waste accumulation with ${yoloRes.detectionCount} dump cluster(s) detected.`,
        formalLetter,
        analysisProvider: "yolo",
        geminiFallback: false,
        model: "garbage_best",
        detections: yoloRes.detections,
        detectionCount: yoloRes.detectionCount,
      });
    }

    // Fallback to Gemini
    return await handleGeminiCivicFallback({
      imageUrl: imageUrl || "data:image/jpeg;base64," + imageBuffer.toString("base64"),
      userName: req.body?.userName,
      locationAddress: req.body?.locationAddress,
      authorityInfo: req.body?.authorityInfo,
      fallbackReason: yoloRes.detectionCount === 0 ? "no_detections" : "low_confidence",
      expectedCategory: "garbage",
      res,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================================================
// DEDICATED STREETLIGHT DETECTION ENDPOINT
// ===================================================
router.post("/streetlight/detect", upload.single("image"), async (req, res) => {
  try {
    let imageUrl = req.body?.imageUrl;
    let imageBuffer = req.file?.buffer;

    if (!imageUrl && !imageBuffer) {
      return res.status(400).json({ message: "Either image file or imageUrl is required." });
    }

    return await handleStreetlightGeminiPrimary({
      imageUrl: imageUrl || "data:image/jpeg;base64," + imageBuffer.toString("base64"),
      userName: req.body?.userName,
      locationAddress: req.body?.locationAddress,
      authorityInfo: req.body?.authorityInfo,
      res,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================================================
// CATEGORY MATCH ENDPOINT — Cross-validate image vs selected category
// ===================================================
router.post("/validate-category", async (req, res) => {
  try {
    const { imageUrl, selectedCategory } = req.body;
    if (!imageUrl || !selectedCategory) {
      return res.status(400).json({ message: "imageUrl and selectedCategory required" });
    }

    if (!visionModel) {
      return res.json({ matches: true, confidence: 0, reason: "AI unavailable" });
    }

    const { base64Image, mimeType } = await fetchImageBase64(imageUrl);

    const prompt = `You are a verification AI. The user selected "${selectedCategory}" as the complaint category.
Look at this image and determine if it matches the selected category.

Return strictly valid JSON:
{"matches": true/false, "imageCategory": "<what the image actually shows>", "confidence": <0-100>, "reason": "<brief reason>"}`;

    const parsed = await callGeminiVision(base64Image, mimeType, prompt);

    res.json({
      matches: parsed.matches,
      imageCategory: parsed.imageCategory || "",
      selectedCategory,
      confidence: parsed.confidence || 0,
      reason: parsed.reason || "",
    });
  } catch (error) {
    console.error("Category validation error:", error.message);
    res.json({ matches: true, confidence: 0, reason: "Validation unavailable" });
  }
});

// ===================================================
// TRANSLATE ENDPOINT — Multi-Language Support
// ===================================================
router.post("/translate", async (req, res) => {
  try {
    const { text, targetLanguage } = req.body;

    if (!text || !targetLanguage) {
      return res.status(400).json({ message: "text and targetLanguage required" });
    }

    const lang = supportedLanguages.find((l) => l.code === targetLanguage);
    if (!lang) {
      return res.status(400).json({ message: `Unsupported language: ${targetLanguage}` });
    }

    if (targetLanguage === "en") {
      return res.json({ translatedText: text, language: lang });
    }

    if (!translationModel) {
      return res.status(500).json({ message: "Translation model not available" });
    }

    let translatedText;
    let lastError;

    for (let i = 0; i < 3; i++) {
      try {
        console.log(`Translation attempt ${i + 1}/3 to ${lang.name}...`);
        const result = await translationModel.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Translate the following formal complaint letter into ${lang.name} (${lang.nativeName}).

CRITICAL TRANSLATION RULES:
- Maintain the EXACT formal tone and structure of the complaint letter
- Preserve headers (To, Subject, Date, Salutation, Body paragraphs, Closing signoff)
- Translate all formal vocabulary, department titles, and administrative phrases faithfully
- Preserve person names, reference IDs, and specific place names accurately
- Do NOT add any conversational remarks, introductions, explanations, or code blocks
- Return ONLY the clean, translated plain text letter

Complaint Letter:
${text}`,
                },
              ],
            },
          ],
        });

        const response = await result.response;
        let rawTranslation = response.text().trim();
        rawTranslation = rawTranslation
          .replace(/^```[\w]*\n?/gm, "")
          .replace(/```$/gm, "")
          .trim();

        translatedText = rawTranslation;
        break;
      } catch (err) {
        lastError = err;
        const msg = err.message || "";
        if (
          (msg.includes("429") ||
            msg.includes("quota") ||
            msg.includes("rate") ||
            msg.includes("Please retry")) &&
          i < 2
        ) {
          const delay = Math.pow(2, i) * 3000;
          await sleep(delay);
        } else {
          throw err;
        }
      }
    }

    if (!translatedText) {
      throw lastError || new Error("Failed to translate text.");
    }

    res.json({ translatedText, language: lang });
  } catch (error) {
    console.error("Gemini Translation Error:", error.message);
    res.status(500).json({ message: "Translation failed: " + error.message });
  }
});

export default router;