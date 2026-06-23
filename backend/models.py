from sqlalchemy import Column, Integer, String, Float, DateTime
from datetime import datetime
from database import Base

class Violation(Base):
    __tablename__ = "violations"

    id = Column(Integer, primary_key=True, index=True)
    violation_type = Column(String)        # "red_light", "wrong_way", "helmet"
    tracker_id = Column(Integer, nullable=True)
    frame = Column(Integer)
    timestamp = Column(DateTime, default=datetime.utcnow)
    snapshot_path = Column(String, nullable=True)
    extra_info = Column(String, nullable=True)  # JSON string for extra fields