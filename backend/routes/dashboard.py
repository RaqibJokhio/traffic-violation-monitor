from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import Violation

router = APIRouter()

@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    total = db.query(Violation).count()
    by_type = db.query(
        Violation.violation_type,
        func.count(Violation.id)
    ).group_by(Violation.violation_type).all()

    return {
        "total_violations": total,
        "by_type": {vtype: count for vtype, count in by_type}
    }