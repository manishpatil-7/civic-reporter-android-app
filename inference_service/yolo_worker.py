import os
import sys
import gc

# Strict single-thread memory containment for Render 512MB RAM tier
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"
os.environ["YOLO_VERBOSE"] = "False"
os.environ["ULTRALYTICS_VERBOSE"] = "False"

import json
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "models")
POTHOLE_PATH = os.environ.get("POTHOLE_MODEL_PATH", os.path.join(MODELS_DIR, "pothole_best.pt"))
GARBAGE_PATH = os.environ.get("GARBAGE_MODEL_PATH", os.path.join(MODELS_DIR, "garbage_best.pt"))

# Lazy cache for loaded models (keeps RAM under 200MB)
models_cache = {}

def get_yolo_model(model_type):
    from ultralytics import YOLO
    import torch
    torch.set_num_threads(1)

    if model_type == "pothole":
        if "pothole" not in models_cache:
            if os.path.exists(POTHOLE_PATH):
                models_cache["pothole"] = YOLO(POTHOLE_PATH)
                sys.stderr.write(f"Worker: Loaded pothole model from {POTHOLE_PATH}\n")
        return models_cache.get("pothole")
    elif model_type == "garbage":
        if "garbage" not in models_cache:
            if os.path.exists(GARBAGE_PATH):
                models_cache["garbage"] = YOLO(GARBAGE_PATH)
                sys.stderr.write(f"Worker: Loaded garbage model from {GARBAGE_PATH}\n")
        return models_cache.get("garbage")
    return None

# Signal instantly to Node.js that the worker process is online (no heavy memory load at boot)
sys.stdout.write(json.dumps({
    "status": "ready",
    "pothole": os.path.exists(POTHOLE_PATH),
    "garbage": os.path.exists(GARBAGE_PATH)
}) + "\n")
sys.stdout.flush()

def run_model_inference(model, img, conf_threshold, target_label):
    if model is None:
        return [], 0.0
    w, h = img.size
    results = model.predict(source=img, imgsz=640, conf=conf_threshold, verbose=False)
    dets = []
    if len(results) > 0 and results[0].boxes is not None:
        for box in results[0].boxes:
            conf = float(box.conf[0].item()) if hasattr(box.conf[0], 'item') else float(box.conf[0])
            xyxy = box.xyxy[0].tolist()
            x1, y1, x2, y2 = xyxy
            norm_x1 = max(0.0, min(1.0, x1 / w))
            norm_y1 = max(0.0, min(1.0, y1 / h))
            norm_x2 = max(0.0, min(1.0, x2 / w))
            norm_y2 = max(0.0, min(1.0, y2 / h))
            box_2d = [int(round(y1)), int(round(x1)), int(round(y2)), int(round(x2))]
            dets.append({
                "box_2d": box_2d,
                "normalized": {
                    "x1": round(norm_x1, 4),
                    "y1": round(norm_y1, 4),
                    "x2": round(norm_x2, 4),
                    "y2": round(norm_y2, 4)
                },
                "label": target_label,
                "confidence": round(conf, 4)
            })
    dets.sort(key=lambda d: d["confidence"], reverse=True)
    max_c = dets[0]["confidence"] if dets else 0.0
    return dets, max_c

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req_id = None
    try:
        req = json.loads(line)
        req_id = req.get("id")
        img_path = req.get("imagePath")
        model_type = req.get("modelType", "both")
        conf = float(req.get("conf", 0.25))

        if not img_path or not os.path.exists(img_path):
            res = {"id": req_id, "success": False, "error": f"Image file not found: {img_path}"}
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()
            continue

        img = Image.open(img_path).convert("RGB")
        w, h = img.size

        pothole_dets, pothole_max_conf = [], 0.0
        garbage_dets, garbage_max_conf = [], 0.0

        if model_type in ["pothole", "both"]:
            p_model = get_yolo_model("pothole")
            if p_model:
                pothole_dets, pothole_max_conf = run_model_inference(p_model, img, conf, "Pothole")

        if model_type in ["garbage", "both"]:
            g_model = get_yolo_model("garbage")
            if g_model:
                garbage_dets, garbage_max_conf = run_model_inference(g_model, img, conf, "Garbage accumulation")

        chosen_model = "none"
        chosen_label = "None"
        detections = []
        max_confidence = 0.0

        if model_type == "pothole":
            chosen_model = "pothole_best"
            chosen_label = "Pothole"
            detections = pothole_dets
            max_confidence = pothole_max_conf
        elif model_type == "garbage":
            chosen_model = "garbage_best"
            chosen_label = "Garbage accumulation"
            detections = garbage_dets
            max_confidence = garbage_max_conf
        else:
            if pothole_max_conf >= garbage_max_conf and len(pothole_dets) > 0:
                chosen_model = "pothole_best"
                chosen_label = "Pothole"
                detections = pothole_dets
                max_confidence = pothole_max_conf
            elif garbage_max_conf > pothole_max_conf and len(garbage_dets) > 0:
                chosen_model = "garbage_best"
                chosen_label = "Garbage accumulation"
                detections = garbage_dets
                max_confidence = garbage_max_conf

        out = {
            "id": req_id,
            "success": True,
            "model": chosen_model,
            "targetClass": chosen_label,
            "architecture": "YOLO11n",
            "analysisProvider": "yolo",
            "geminiFallback": False,
            "imageWidth": w,
            "imageHeight": h,
            "detectionCount": len(detections),
            "maxConfidence": max_confidence,
            "detections": detections,
            "allDetections": {
                "pothole": pothole_dets,
                "garbage": garbage_dets
            },
            "canReportManually": True
        }
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()

        # Clean memory after inference
        gc.collect()
    except Exception as e:
        sys.stdout.write(json.dumps({"id": req_id, "success": False, "error": str(e)}) + "\n")
        sys.stdout.flush()
