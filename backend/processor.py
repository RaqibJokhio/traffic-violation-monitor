import cv2
import numpy as np
import supervision as sv
from ultralytics import YOLO
import os, base64, asyncio
from datetime import datetime
from sqlalchemy.orm import Session
from models import Violation
from fastapi import WebSocket

VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
VEHICLE_MODEL_PATH = "yolov8n.pt"       # nano for speed
HELMET_MODEL_PATH  = "../weights/helmet_model.pt"

async def process_video_stream(video_path: str, db: Session, job_id: str, websocket: WebSocket):
    snapshots_dir = f"uploads/{job_id}"
    os.makedirs(snapshots_dir, exist_ok=True)

    vehicle_model = YOLO(VEHICLE_MODEL_PATH)
    helmet_model  = YOLO(HELMET_MODEL_PATH)

    HELMET_NO_IDS = [k for k, v in helmet_model.names.items() if "no" in v.lower()]

    tracker        = sv.ByteTrack()
    box_annotator  = sv.BoxAnnotator()
    label_annotator = sv.LabelAnnotator()

    cap    = cv2.VideoCapture(video_path)
    fps    = cap.get(cv2.CAP_PROP_FPS) or 25
    width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Scale down for streaming performance
    STREAM_W, STREAM_H = 854, 480

    STOP_LINES = []  # disabled until per-video config
    ALLOWED_DIRECTION = 270
    ANGLE_THRESHOLD   = 90
    MIN_TRACK_FRAMES  = 15

    track_history   = {}
    logged_redlight = set()
    logged_wrongway = set()
    logged_helmet   = set()
    frame_count     = 0

    stats = {"total": 0, "red_light": 0, "wrong_way": 0, "helmet": 0}

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Resize for faster processing
        frame = cv2.resize(frame, (STREAM_W, STREAM_H))

        # Vehicle detection + tracking
        v_results    = vehicle_model(frame, verbose=False)[0]
        v_detections = sv.Detections.from_ultralytics(v_results)
        mask = [int(c) in VEHICLE_CLASSES for c in v_detections.class_id]
        v_detections = v_detections[mask]
        v_detections = tracker.update_with_detections(v_detections)

        # Helmet detection
        h_results    = helmet_model(frame, verbose=False)[0]
        h_detections = sv.Detections.from_ultralytics(h_results)

        violation_labels = {}

        if v_detections.tracker_id is not None:
            for i, tracker_id in enumerate(v_detections.tracker_id):
                bbox = v_detections.xyxy[i]
                cx = int((bbox[0] + bbox[2]) / 2)
                cy = int((bbox[1] + bbox[3]) / 2)

                if tracker_id not in track_history:
                    track_history[tracker_id] = []
                track_history[tracker_id].append((cx, cy))
                track_history[tracker_id] = track_history[tracker_id][-30:]

                # Red-light
                for sl in STOP_LINES:
                    key = (tracker_id, sl["id"])
                    if key not in logged_redlight and _is_crossing(bbox, sl["line"]):
                        logged_redlight.add(key)
                        snap = f"{snapshots_dir}/redlight_{tracker_id}_{frame_count}.jpg"
                        cv2.imwrite(snap, frame)
                        _save_violation(db, "red_light", frame_count, int(tracker_id), snap)
                        violation_labels[tracker_id] = "RED LIGHT"
                        stats["red_light"] += 1
                        stats["total"] += 1

                # Wrong-way
                positions = track_history[tracker_id]
                if len(positions) >= MIN_TRACK_FRAMES:
                    angle = _movement_angle(positions)
                    if angle is not None and _angle_diff(angle, ALLOWED_DIRECTION) > ANGLE_THRESHOLD:
                        if tracker_id not in logged_wrongway:
                            logged_wrongway.add(tracker_id)
                            snap = f"{snapshots_dir}/wrongway_{tracker_id}_{frame_count}.jpg"
                            cv2.imwrite(snap, frame)
                            _save_violation(db, "wrong_way", frame_count, int(tracker_id), snap, f"angle:{angle:.1f}")
                            violation_labels[tracker_id] = "WRONG WAY"
                            stats["wrong_way"] += 1
                            stats["total"] += 1

        # Helmet
        helmet_tracker_ids = set()
        for i, cls_id in enumerate(h_detections.class_id):
            if int(cls_id) in HELMET_NO_IDS:
                # Find nearest vehicle tracker_id
                hbbox = h_detections.xyxy[i]
                hcx = int((hbbox[0] + hbbox[2]) / 2)
                hcy = int((hbbox[1] + hbbox[3]) / 2)
                nearest_id = _nearest_tracker(hcx, hcy, v_detections)
                key = nearest_id if nearest_id is not None else f"frame_{frame_count}"
                if key not in logged_helmet:
                    logged_helmet.add(key)
                    snap = f"{snapshots_dir}/helmet_{frame_count}.jpg"
                    cv2.imwrite(snap, frame)
                    _save_violation(db, "helmet", frame_count, nearest_id, snap)
                    stats["helmet"] += 1
                    stats["total"] += 1

        # Annotate
        if v_detections.tracker_id is not None:
            labels = [
                f"ID{tid} {violation_labels.get(tid, VEHICLE_CLASSES.get(int(cls), 'v'))} {conf:.2f}"
                for tid, cls, conf in zip(
                    v_detections.tracker_id,
                    v_detections.class_id,
                    v_detections.confidence
                )
            ]
            frame = box_annotator.annotate(scene=frame, detections=v_detections)
            frame = label_annotator.annotate(scene=frame, detections=v_detections, labels=labels)

        # Encode frame to base64 and send
        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        frame_b64 = base64.b64encode(buffer).decode("utf-8")

        await websocket.send_json({
            "type": "frame",
            "frame": frame_b64,
            "stats": stats,
            "frame_count": frame_count
        })

        # Yield control to event loop every frame
        await asyncio.sleep(0)
        frame_count += 1

    cap.release()


def _nearest_tracker(cx, cy, detections):
    if detections.tracker_id is None or len(detections.tracker_id) == 0:
        return None
    min_dist = float("inf")
    nearest = None
    for i, tid in enumerate(detections.tracker_id):
        bbox = detections.xyxy[i]
        vcx = int((bbox[0] + bbox[2]) / 2)
        vcy = int((bbox[1] + bbox[3]) / 2)
        dist = ((cx - vcx) ** 2 + (cy - vcy) ** 2) ** 0.5
        if dist < min_dist:
            min_dist = dist
            nearest = int(tid)
    return nearest

def _save_violation(db, vtype, frame, tracker_id, snap, extra=None):
    v = Violation(
        violation_type=vtype,
        frame=frame,
        tracker_id=tracker_id,
        snapshot_path=snap,
        extra_info=extra,
        timestamp=datetime.utcnow()
    )
    db.add(v)
    db.commit()

def _is_crossing(bbox, line):
    x1, y1, x2, y2 = line
    bx1, by1, bx2, by2 = bbox
    vehicle_cx = (bx1 + bx2) / 2
    if x2 == x1:
        return False
    line_y = y1 + (y2 - y1) / (x2 - x1) * (vehicle_cx - x1)
    return by2 >= line_y

def _movement_angle(positions):
    x1, y1 = positions[0]
    x2, y2 = positions[-1]
    dx, dy = x2 - x1, y1 - y2
    return np.degrees(np.arctan2(dy, dx)) % 360

def _angle_diff(a1, a2):
    diff = abs(a1 - a2) % 360
    return min(diff, 360 - diff)