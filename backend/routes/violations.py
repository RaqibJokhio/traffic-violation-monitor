from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.orm import Session
from database import get_db
from models import Violation
from typing import Optional
import shutil, os, json
from datetime import datetime

router = APIRouter()

@router.get("/")
def get_violations(
    violation_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    query = db.query(Violation)
    if violation_type:
        query = query.filter(Violation.violation_type == violation_type)
    total = query.count()
    violations = query.order_by(Violation.timestamp.desc()).offset(offset).limit(limit).all()
    return {"total": total, "violations": violations}

@router.post("/")
def create_violation(
    violation_type: str,
    frame: int,
    tracker_id: Optional[int] = None,
    extra_info: Optional[str] = None,
    db: Session = Depends(get_db)
):
    violation = Violation(
        violation_type=violation_type,
        frame=frame,
        tracker_id=tracker_id,
        extra_info=extra_info,
        timestamp=datetime.utcnow()
    )
    db.add(violation)
    db.commit()
    db.refresh(violation)
    return violation

@router.post("/{violation_id}/snapshot")
def upload_snapshot(
    violation_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    violation = db.query(Violation).filter(Violation.id == violation_id).first()
    if not violation:
        return {"error": "Violation not found"}

    path = f"uploads/{violation_id}_{file.filename}"
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    violation.snapshot_path = path
    db.commit()
    return {"snapshot_path": path}

@router.delete("/{violation_id}")
def delete_violation(violation_id: int, db: Session = Depends(get_db)):
    violation = db.query(Violation).filter(Violation.id == violation_id).first()
    if not violation:
        return {"error": "Not found"}
    db.delete(violation)
    db.commit()
    return {"deleted": violation_id}