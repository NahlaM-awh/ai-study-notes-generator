"""
Optional Ollama integration — free local LLM, no API keys.
"""

from __future__ import annotations

import json
import os
from typing import AsyncGenerator

import httpx

OLLAMA_BASE = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")


def build_prompt(notes: str) -> str:
    return f"""Transform these study notes into structured materials with sections:
## 📝 Summary
## • Bullet Points
## 📖 Important Definitions
## ❓ Quiz Questions (exactly 5 with answers)
## 🎯 Key Takeaways
## 📅 Suggested Study Plan
## 💡 Memory Tips
## 🔗 Related Topics to Explore

Notes:
{notes}
"""


async def ollama_available() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            return r.status_code == 200
    except Exception:
        return False


async def stream_ollama_notes(notes: str) -> AsyncGenerator[str, None]:
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [{"role": "user", "content": build_prompt(notes)}],
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", f"{OLLAMA_BASE}/api/chat", json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                data = json.loads(line)
                if data.get("done"):
                    break
                delta = data.get("message", {}).get("content", "")
                if delta:
                    yield delta
