"""
AI Study Notes Generator — FastAPI Backend

No API keys required: uses a built-in local engine by default.
Optional: Ollama for richer AI (also free, local).
"""

import json
import os
from pathlib import Path
from typing import AsyncGenerator, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from notes_engine import stream_local_notes
from ollama_client import ollama_available, stream_ollama_notes

load_dotenv()

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
AI_PROVIDER = os.getenv("AI_PROVIDER", "local").lower()  # local | ollama | auto

app = FastAPI(
    title="AI Study Notes Generator",
    description="Transform raw notes into structured study materials — no API keys.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    notes: str = Field(..., min_length=10, max_length=50000)
    depth: Literal["quick", "standard", "deep"] = "standard"
    prefer_ollama: bool = False


async def resolve_provider(prefer_ollama: bool) -> str:
    """Pick ollama when available and requested, else local engine."""
    if AI_PROVIDER == "local":
        return "local"
    if AI_PROVIDER == "ollama":
        if await ollama_available():
            return "ollama"
        return "local"
    # auto: local by default; Ollama only when user enables the toggle
    if prefer_ollama and await ollama_available():
        return "ollama"
    return "local"


async def stream_study_notes(
    notes: str, depth: str, prefer_ollama: bool
) -> AsyncGenerator[str, None]:
    provider = await resolve_provider(prefer_ollama)
    yield f"event: start\ndata: {json.dumps({'status': 'generating', 'provider': provider})}\n\n"

    try:
        if provider == "ollama":
            async for chunk in stream_ollama_notes(notes):
                payload = json.dumps({"content": chunk})
                yield f"event: delta\ndata: {payload}\n\n"
        else:
            async for chunk in stream_local_notes(notes, depth=depth):
                payload = json.dumps({"content": chunk})
                yield f"event: delta\ndata: {payload}\n\n"

        yield f"event: done\ndata: {json.dumps({'status': 'complete', 'provider': provider})}\n\n"
    except Exception as exc:
        yield f"event: error\ndata: {json.dumps({'error': str(exc)})}\n\n"


@app.get("/api/health")
async def health_check():
    ollama_ok = await ollama_available()
    return {
        "status": "ok",
        "api_keys_required": False,
        "provider_default": "local",
        "ollama_available": ollama_ok,
        "ai_provider_env": AI_PROVIDER,
    }


@app.post("/api/generate")
async def generate_study_notes(request: GenerateRequest):
    return StreamingResponse(
        stream_study_notes(request.notes, request.depth, request.prefer_ollama),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/ocr")
async def ocr_image(file: UploadFile = File(...)):
    """
    Optional server-side OCR (requires Tesseract installed on the system).
    Primary OCR path is Tesseract.js in the browser — no keys needed.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload a valid image file.")

    try:
        import io

        from PIL import Image

        raw = await file.read()
        image = Image.open(io.BytesIO(raw))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read image: {exc}") from exc

    try:
        import pytesseract

        text = pytesseract.image_to_string(image)
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Server OCR unavailable. Use in-browser photo scan (recommended) or install Tesseract.",
        ) from None

    cleaned = text.strip()
    if len(cleaned) < 5:
        raise HTTPException(status_code=422, detail="Could not extract enough text from the image.")

    return {"text": cleaned, "source": "server_tesseract"}


if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
async def serve_index():
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    raise HTTPException(status_code=404, detail="Frontend not found.")


@app.get("/style.css")
async def serve_css():
    css_path = FRONTEND_DIR / "style.css"
    if css_path.exists():
        return FileResponse(css_path, media_type="text/css")
    raise HTTPException(status_code=404, detail="Stylesheet not found.")


@app.get("/script.js")
async def serve_js():
    js_path = FRONTEND_DIR / "script.js"
    if js_path.exists():
        return FileResponse(js_path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="Script not found.")
