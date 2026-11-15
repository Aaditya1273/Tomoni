"""Voice Lab feature service: POST a WAV, get SpeechFeatures back. No patient identifiers in or out."""
from fastapi import FastAPI, HTTPException, Request

from features import extract

app = FastAPI(title="Tomoni ML (research only)")
MAX_BYTES = 120 * 16000 * 2 + 1024  # 120 s of 16 kHz mono


@app.post("/v1/features")
async def features(req: Request):
    body = await req.body()
    if len(body) > MAX_BYTES:
        raise HTTPException(413, "audio too long")
    try:
        return extract(body)
    except Exception as e:  # malformed WAV, wrong sample width, too long
        raise HTTPException(422, f"unreadable audio: {e}") from e


@app.get("/health")
def health():
    return {"ok": True}
