# AI Study Notes Generator v2

Transform raw or **photo** notes into structured study materials — **no OpenAI API key required**.

## What’s new

- **100% free default engine** — runs locally in Python (no cloud API)
- **Photo notes** — upload or drag-drop images; **Tesseract.js** OCR in the browser
- **Extra sections** — study plan, memory tips, related topics
- **Copy / export Markdown**, session history, depth modes (Quick / Standard / Deep)
- **Optional Ollama** — better AI quality if you install [Ollama](https://ollama.com) locally

## Quick start

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000**

## Photo workflow

1. Click the **image icon** or drag a photo onto the page  
2. Click **Scan photo** (runs OCR in your browser — no API key)  
3. Edit extracted text if needed, then **Generate**

## Optional: Ollama (better wording)

```powershell
ollama pull llama3.2
```

Set in `.env`:

```env
AI_PROVIDER=auto
```

Or enable **Use Ollama** in the app toolbar.

## Environment

| Variable       | Default              | Description                          |
|----------------|----------------------|--------------------------------------|
| `AI_PROVIDER`  | `local`              | `local`, `ollama`, or `auto`         |
| `OLLAMA_HOST`  | `http://127.0.0.1:11434` | Ollama API URL                   |
| `OLLAMA_MODEL` | `llama3.2`           | Model name in Ollama                 |

No `OPENAI_API_KEY` is used.

## Docker

```bash
docker compose up --build
```

## API

- `GET /api/health` — engine status  
- `POST /api/generate` — SSE stream (`notes`, `depth`, `prefer_ollama`)  
- `POST /api/ocr` — optional server OCR (needs Tesseract on host)

## License

MIT
