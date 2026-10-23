import os
import io
import sys
from typing import Optional, List
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
import urllib.request
from ultralytics import YOLO

app = FastAPI(title="Civic Reporter YOLO Inference Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "models")
POTHOLE_MODEL_PATH = os.environ.get("POTHOLE_MODEL_PATH", os.path.join(MODELS_DIR, "pothole_best.pt"))
GARBAGE_MODEL_PATH = os.environ.get("GARBAGE_MODEL_PATH", os.path.join(MODELS_DIR, "garbage_best.pt"))

pothole_model = None
garbage_model = None

try:
    if os.path.exists(POTHOLE_MODEL_PATH):
        pothole_model = YOLO(POTHOLE_MODEL_PATH)
        print(f"Loaded Pothole model from: {POTHOLE_MODEL_PATH}")
    else:
        print(f"Warning: Pothole model not found at {POTHOLE_MODEL_PATH}")
except Exception as e:
    print(f"Error loading pothole model: {e}")

try:
    if os.path.exists(GARBAGE_MODEL_PATH):
        garbage_model = YOLO(GARBAGE_MODEL_PATH)
        print(f"Loaded Garbage model from: {GARBAGE_MODEL_PATH}")
    else:
        print(f"Warning: Garbage model not found at {GARBAGE_MODEL_PATH}")
except Exception as e:
    print(f"Error loading garbage model: {e}")


def run_yolo_on_image(model, img: Image.Image, conf_threshold: float, target_label: str):
    w, h = img.size
    results = model.predict(source=img, conf=conf_threshold, verbose=False)
    detections = []
    
    if len(results) > 0 and results[0].boxes is not None:
        boxes = results[0].boxes
        for box in boxes:
            conf = float(box.conf[0].item()) if hasattr(box.conf[0], 'item') else float(box.conf[0])
            xyxy = box.xyxy[0].tolist()
            x1, y1, x2, y2 = xyxy
            
            # Normalized coordinates (0.0 to 1.0)
            norm_x1 = max(0.0, min(1.0, x1 / w))
            norm_y1 = max(0.0, min(1.0, y1 / h))
            norm_x2 = max(0.0, min(1.0, x2 / w))
            norm_y2 = max(0.0, min(1.0, y2 / h))
            
            # box_2d [ymin, xmin, ymax, xmax] in pixels
            box_2d = [int(round(y1)), int(round(x1)), int(round(y2)), int(round(x2))]
            
            cls_idx = int(box.cls[0].item()) if hasattr(box.cls[0], 'item') else int(box.cls[0])
            raw_label = model.names.get(cls_idx, target_label) if hasattr(model, 'names') else target_label
            label = target_label if target_label else raw_label
            
            detections.append({
                "box_2d": box_2d,
                "normalized": {
                    "x1": round(norm_x1, 4),
                    "y1": round(norm_y1, 4),
                    "x2": round(norm_x2, 4),
                    "y2": round(norm_y2, 4),
                },
                "label": label,
                "confidence": round(conf, 4)
            })
            
    # Sort detections by confidence descending
    detections.sort(key=lambda d: d["confidence"], reverse=True)
    max_conf = detections[0]["confidence"] if detections else 0.0
    return detections, max_conf


@app.get("/health")
@app.get("/status")
def health_check():
    return {
        "status": "online",
        "service": "Civic Reporter YOLO Inference Service",
        "models": {
            "pothole_best": pothole_model is not None,
            "garbage_best": garbage_model is not None,
        },
        "paths": {
            "pothole": POTHOLE_MODEL_PATH,
            "garbage": GARBAGE_MODEL_PATH,
        }
    }


@app.post("/detect")
async def detect(
    file: Optional[UploadFile] = File(None),
    image_url: Optional[str] = Form(None),
    image_path: Optional[str] = Form(None),
    model_type: str = Form("both"),  # "pothole", "garbage", or "both"
    confidence_threshold: float = Form(0.25),
):
    img = None
    try:
        if file is not None:
            content = await file.read()
            img = Image.open(io.BytesIO(content)).convert("RGB")
        elif image_path and os.path.exists(image_path):
            img = Image.open(image_path).convert("RGB")
        elif image_url:
            req = urllib.request.Request(image_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                content = response.read()
            img = Image.open(io.BytesIO(content)).convert("RGB")
        else:
            raise HTTPException(status_code=400, detail="Must provide an uploaded image file, image_path, or image_url")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read image: {str(e)}")

    w, h = img.size
    pothole_dets = []
    pothole_max_conf = 0.0
    garbage_dets = []
    garbage_max_conf = 0.0

    if model_type in ["pothole", "both"]:
        if pothole_model is not None:
            pothole_dets, pothole_max_conf = run_yolo_on_image(
                pothole_model, img, confidence_threshold, "Pothole"
            )

    if model_type in ["garbage", "both"]:
        if garbage_model is not None:
            garbage_dets, garbage_max_conf = run_yolo_on_image(
                garbage_model, img, confidence_threshold, "Garbage"
            )

    # Resolve primary detection
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
    else:  # "both"
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

    return {
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
            "garbage": garbage_dets,
        },
        "canReportManually": True,
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("YOLO_PORT", 8000))
    print(f"Starting Civic Reporter YOLO inference service on port {port}...")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
