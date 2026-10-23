import os
import sys
import json
import argparse
from PIL import Image
from ultralytics import YOLO

def main():
    parser = argparse.ArgumentParser(description="Civic Reporter CLI YOLO Inference Runner")
    parser.add_argument("--image", required=True, help="Path to image file")
    parser.add_argument("--model", default="both", choices=["pothole", "garbage", "both"], help="Model to run")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    parser.add_argument("--pothole-weights", default=None, help="Path to pothole_best.pt")
    parser.add_argument("--garbage-weights", default=None, help="Path to garbage_best.pt")
    args = parser.parse_args()

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    models_dir = os.path.join(base_dir, "models")
    pothole_path = args.pothole_weights or os.environ.get("POTHOLE_MODEL_PATH", os.path.join(models_dir, "pothole_best.pt"))
    garbage_path = args.garbage_weights or os.environ.get("GARBAGE_MODEL_PATH", os.path.join(models_dir, "garbage_best.pt"))

    if not os.path.exists(args.image):
        print(json.dumps({"success": False, "error": f"Image file not found: {args.image}"}))
        sys.exit(1)

    try:
        img = Image.open(args.image).convert("RGB")
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to open image: {str(e)}"}))
        sys.exit(1)

    w, h = img.size
    pothole_dets = []
    pothole_max_conf = 0.0
    garbage_dets = []
    garbage_max_conf = 0.0

    def run_model(model_path, target_label):
        if not os.path.exists(model_path):
            return [], 0.0
        try:
            model = YOLO(model_path)
            results = model.predict(source=img, conf=args.conf, verbose=False)
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
        except Exception as e:
            return [], 0.0

    if args.model in ["pothole", "both"]:
        pothole_dets, pothole_max_conf = run_model(pothole_path, "Pothole")

    if args.model in ["garbage", "both"]:
        garbage_dets, garbage_max_conf = run_model(garbage_path, "Garbage accumulation")

    chosen_model = "none"
    chosen_label = "None"
    detections = []
    max_confidence = 0.0

    if args.model == "pothole":
        chosen_model = "pothole_best"
        chosen_label = "Pothole"
        detections = pothole_dets
        max_confidence = pothole_max_conf
    elif args.model == "garbage":
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

    output = {
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
    print(json.dumps(output))

if __name__ == "__main__":
    main()
