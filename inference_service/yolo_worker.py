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

# Ensure line buffering for stdin/stdout
try:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(line_buffering=True)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

import json
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "models")
POTHOLE_PATH = os.environ.get("POTHOLE_MODEL_PATH", os.path.join(MODELS_DIR, "pothole_best.pt"))
GARBAGE_PATH = os.environ.get("GARBAGE_MODEL_PATH", os.path.join(MODELS_DIR, "garbage_best.pt"))

# Only keep at most ONE active model in memory to guarantee RAM <= 220MB on Render 512MB tier
current_loaded_type = None
current_model = None

def get_yolo_model(model_type):
    global current_loaded_type, current_model
    import torch
    from ultralytics import YOLO
    torch.set_num_threads(1)

    if current_loaded_type == model_type and current_model is not None:
        return current_model

    # Eject previous model to keep memory well under 220MB
    if current_model is not None:
        try:
            del current_model
        except Exception:
            pass
        current_model = None
        current_loaded_type = None
        gc.collect()

    path = POTHOLE_PATH if model_type == "pothole" else GARBAGE_PATH
    if os.path.exists(path):
        current_model = YOLO(path)
        current_loaded_type = model_type
        sys.stderr.write(f"Worker: Loaded {model_type} model from {path}\n")
        return current_model
    return None

# Signal instantly to Node.js that the worker process is online (no heavy memory load at boot)
sys.stdout.write(json.dumps({
    "status": "ready",
    "pothole": os.path.exists(POTHOLE_PATH),
    "garbage": os.path.exists(GARBAGE_PATH)
}) + "\n")
sys.stdout.flush()

def run_model_inference(model, img, conf_threshold, target_label, orig_w=None, orig_h=None):
    if model is None:
        return [], 0.0
    iw, ih = img.size
    orig_w = orig_w or iw
    orig_h = orig_h or ih
    import torch
    with torch.inference_mode():
        results = model.predict(source=img, imgsz=480, conf=conf_threshold, verbose=False)
    dets = []
    if len(results) > 0 and results[0].boxes is not None:
        for box in results[0].boxes:
            conf = float(box.conf[0].item()) if hasattr(box.conf[0], 'item') else float(box.conf[0])
            xyxy = box.xyxy[0].tolist()
            x1, y1, x2, y2 = xyxy
            norm_x1 = max(0.0, min(1.0, x1 / iw))
            norm_y1 = max(0.0, min(1.0, y1 / ih))
            norm_x2 = max(0.0, min(1.0, x2 / iw))
            norm_y2 = max(0.0, min(1.0, y2 / ih))
            box_2d = [
                int(round(norm_y1 * orig_h)),
                int(round(norm_x1 * orig_w)),
                int(round(norm_y2 * orig_h)),
                int(round(norm_x2 * orig_w))
            ]
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

while True:
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()
    if not line:
        continue
    req_id = None
    try:
        req = json.loads(line)
        req_id = req.get("id")
        img_path = req.get("imagePath")
        model_type = req.get("modelType", "both")
        conf = float(req.get("conf", 0.20))

        if not img_path or not os.path.exists(img_path):
            res = {"id": req_id, "success": False, "error": f"Image file not found: {img_path}"}
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()
            continue

        orig_img = Image.open(img_path).convert("RGB")
        w, h = orig_img.size
        infer_img = orig_img.copy()
        if max(w, h) > 640:
            infer_img.thumbnail((640, 640), Image.Resampling.LANCZOS)
        iw, ih = infer_img.size
        del orig_img
        gc.collect()

        pothole_dets, pothole_max_conf = [], 0.0
        garbage_dets, garbage_max_conf = [], 0.0

        if model_type in ["pothole", "both"]:
            p_model = get_yolo_model("pothole")
            if p_model:
                pothole_dets, pothole_max_conf = run_model_inference(p_model, infer_img, conf, "Pothole", orig_w=w, orig_h=h)

        # When running both: if pothole confirmed with high confidence, skip loading garbage model to save RAM
        skip_garbage = (model_type == "both" and pothole_max_conf >= conf and len(pothole_dets) > 0)

        if model_type in ["garbage", "both"] and not skip_garbage:
            g_model = get_yolo_model("garbage")
            if g_model:
                garbage_dets, garbage_max_conf = run_model_inference(g_model, infer_img, conf, "Garbage accumulation", orig_w=w, orig_h=h)

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
