from fastapi import FastAPI, UploadFile, File, BackgroundTasks, Depends, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from database import engine, Base, get_db
from routes import violations, dashboard
from sqlalchemy.orm import Session
import os, uuid, shutil, asyncio

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Traffic Violation Monitor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

app.include_router(violations.router, prefix="/violations", tags=["violations"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])

jobs = {}
job_queues = {}

@app.post("/process")
async def upload_and_process(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    job_id = str(uuid.uuid4())[:8]
    video_path = f"uploads/{job_id}_{file.filename}"

    with open(video_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    jobs[job_id] = "queued"
    job_queues[job_id] = asyncio.Queue()

    return {"job_id": job_id, "status": "queued", "video_path": video_path}

@app.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str, db: Session = Depends(get_db)):
    await websocket.accept()
    jobs[job_id] = "processing"

    try:
        from processor import process_video_stream
        await process_video_stream(
            video_path=f"uploads/{job_id}_" + next(
                f for f in os.listdir("uploads") if f.startswith(job_id) and not os.path.isdir(f"uploads/{f}")
            ),
            db=db,
            job_id=job_id,
            websocket=websocket
        )
        jobs[job_id] = "done"
        await websocket.send_json({"type": "done"})
    except WebSocketDisconnect:
        jobs[job_id] = "disconnected"
    except Exception as e:
        jobs[job_id] = f"error: {str(e)}"
        print(f"WS error: {e}")

@app.get("/process/{job_id}/status")
def get_job_status(job_id: str):
    return {"job_id": job_id, "status": jobs.get(job_id, "not_found")}

@app.get("/")
def root():
    return {"status": "running"}