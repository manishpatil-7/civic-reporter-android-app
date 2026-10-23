/**
 * Systematic Test Script for Civic Reporter YOLO-First + Gemini Fallback Architecture
 * Verifies all 20 requirements from user specification
 */
import path from "path";
import { fileURLToPath } from "url";
import { INFERENCE_CONFIG } from "./config/inferenceConfig.js";
import {
  runYoloInference,
  checkLocalModelsAvailable,
  checkYoloServiceHealth,
} from "./utils/yoloInference.js";
import {
  generateDeterministicLetter,
  getTemplateType,
  TEMPLATE_TYPES,
} from "./utils/complaintTemplates.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log("==========================================================");
  console.log("CIVIC REPORTER AI WORKFLOW VERIFICATION SUITE");
  console.log("==========================================================\n");

  let passed = 0;
  let total = 0;

  function assert(condition, testName) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
    }
  }

  // TEST 1: Model weights verification
  console.log("--- 1. Model Weights & Configuration ---");
  const models = checkLocalModelsAvailable();
  assert(models.pothole === true, "pothole_best.pt is physically present on disk");
  assert(models.garbage === true, "garbage_best.pt is physically present on disk");
  assert(models.allReady === true, "Both YOLO models are verified ready");
  assert(INFERENCE_CONFIG.potholeConfidenceThreshold === 0.25, "Pothole confidence threshold centrally configured to 0.25");
  assert(INFERENCE_CONFIG.garbageConfidenceThreshold === 0.25, "Garbage confidence threshold centrally configured to 0.25");

  // TEST 2: Local YOLO Inference Runner (CLI fallback & execution)
  console.log("\n--- 2. Local YOLO Inference Execution ---");
  const testImagePath = path.resolve(__dirname, "../civic-reporter-android/assets/icon.png");
  
  const potholeRes = await runYoloInference({
    imagePath: testImagePath,
    modelType: "pothole",
    confidenceThreshold: 0.25,
  });
  assert(potholeRes.success === true, "YOLO inference executed successfully via runner");
  assert(potholeRes.architecture === "YOLO11n", "Architecture identified as YOLO11n");
  assert(potholeRes.analysisProvider === "yolo", "Provider identified as yolo");
  assert(potholeRes.geminiFallback === false, "Gemini fallback is false on successful YOLO execution");

  const garbageRes = await runYoloInference({
    imagePath: testImagePath,
    modelType: "garbage",
    confidenceThreshold: 0.25,
  });
  assert(garbageRes.success === true, "YOLO garbage model executed successfully via runner");
  assert(garbageRes.targetClass === "Garbage accumulation", "Target class correctly mapped for garbage");

  // TEST 3: Deterministic Template Generation (No Gemini reliance for letter drafting)
  console.log("\n--- 3. Deterministic Complaint Letter Generation ---");

  // A. Road Damage
  const roadLetter = generateDeterministicLetter({
    templateType: TEMPLATE_TYPES.ROAD_DAMAGE,
    userName: "Aarav Sharma",
    locationAddress: "MG Road, Pune, Maharashtra",
    problemType: "Pothole",
    detectionCount: 2,
    severity: "High",
  });
  assert(roadLetter.includes("severe road surface deterioration"), "Road damage letter contains specific road defect terminology");
  assert(roadLetter.includes("2 prominent potholes"), "Road damage letter reflects accurate detection count");
  assert(roadLetter.includes("MG Road, Pune"), "Road damage letter includes exact location");
  assert(roadLetter.includes("Aarav Sharma"), "Road damage letter includes citizen name");

  // B. Garbage
  const garbageLetter = generateDeterministicLetter({
    templateType: TEMPLATE_TYPES.GARBAGE,
    userName: "Priya Patel",
    locationAddress: "Sector 14, Navi Mumbai",
    problemType: "Garbage Dump",
    detectionCount: 1,
    severity: "Medium",
  });
  assert(garbageLetter.includes("uncollected solid waste accumulation"), "Garbage letter includes sanitary waste terminology");
  assert(garbageLetter.includes("Solid Waste Management and Public Health Department"), "Garbage letter addresses proper municipal department");

  // C. Streetlight (Physical damage without unverified electrical assumptions)
  const streetlightLetter = generateDeterministicLetter({
    templateType: TEMPLATE_TYPES.STREETLIGHT,
    userName: "Rohan Verma",
    locationAddress: "Brigade Road, Bangalore",
    problemType: "Streetlight Fault",
    detectedDefects: ["bent pole", "shattered lamp fixture"],
    severity: "High",
  });
  assert(streetlightLetter.includes("bent pole, shattered lamp fixture"), "Streetlight letter includes inspected physical defects");
  assert(!streetlightLetter.includes("short circuit burned the city grid"), "Streetlight letter avoids unverified electrical speculation");

  // D. Drainage
  const drainageLetter = generateDeterministicLetter({
    templateType: TEMPLATE_TYPES.DRAINAGE,
    userName: "Vikram Das",
    locationAddress: "Park Street, Kolkata",
    problemType: "Broken Drainage",
  });
  assert(drainageLetter.includes("stormwater overflow, and waterlogging"), "Drainage letter uses appropriate municipal sewerage terms");

  // E. Template routing helper
  assert(getTemplateType("pothole") === TEMPLATE_TYPES.ROAD_DAMAGE, "getTemplateType routes pothole correctly");
  assert(getTemplateType("garbage dump") === TEMPLATE_TYPES.GARBAGE, "getTemplateType routes garbage dump correctly");
  assert(getTemplateType("streetlight fault") === TEMPLATE_TYPES.STREETLIGHT, "getTemplateType routes streetlight correctly");
  assert(getTemplateType("blocked drainage") === TEMPLATE_TYPES.DRAINAGE, "getTemplateType routes drainage correctly");

  // Summary
  console.log("\n==========================================================");
  console.log(`TEST RESULTS: ${passed}/${total} PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log("==========================================================");

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
