import asyncio
import json
import logging
import pathlib
import time

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

import db
from config import (
    BOT_SECRET,
    ELEVENLABS_API_KEY,
    ENV,
    ALLOWED_ORIGINS,
    LOCAL_ORIGIN_REGEX,
)

# Voice cache (refreshed periodically)
_voices_cache: list[dict] = []
_voices_cache_ts: float = 0.0
VOICES_CACHE_TTL = 300  # 5 minutes

logger = logging.getLogger("fablescribe")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Fablescribe backend starting")
    yield
    await db.close_conn()
    logger.info("Fablescribe backend stopped")


app = FastAPI(title="Fablescribe Backend", lifespan=lifespan)

# CORS: explicit origins from env take precedence; the local regex is always
# allowed as a fallback so dev sessions on LAN/localhost continue to work.
cors_kwargs = {
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
    "allow_origin_regex": LOCAL_ORIGIN_REGEX,
}
if ALLOWED_ORIGINS:
    cors_kwargs["allow_origins"] = ALLOWED_ORIGINS
    logger.info(f"CORS allowed origins: {ALLOWED_ORIGINS} (+ local regex)")
else:
    logger.info(f"CORS allowed origins: local regex only (env={ENV})")

app.add_middleware(CORSMiddleware, **cors_kwargs)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/voices")
async def list_voices():
    """Return voices from the user's ElevenLabs 'My Voices' library, with preview URLs."""
    global _voices_cache, _voices_cache_ts

    if time.time() - _voices_cache_ts < VOICES_CACHE_TTL and _voices_cache:
        return _voices_cache

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://api.elevenlabs.io/v1/voices",
                headers={"xi-api-key": ELEVENLABS_API_KEY},
            )
        resp.raise_for_status()
        voices = resp.json().get("voices", [])
        _voices_cache = [
            {
                "id": v["voice_id"],
                "name": v.get("name", v["voice_id"]),
                "preview_url": v.get("preview_url", ""),
            }
            for v in voices
        ]
        _voices_cache_ts = time.time()
    except Exception as e:
        logger.error(f"Failed to fetch ElevenLabs voices: {e}")
        # Fall back to cached if any
        return _voices_cache

    return _voices_cache


# ── Import and include routers ───────────────────────────────────────────────
from routers import campaigns, sessions, characters, glossary, files, memory, chatbot, speakers

app.include_router(campaigns.router, prefix="/campaigns", tags=["campaigns"])
app.include_router(sessions.router, tags=["sessions"])
app.include_router(characters.router, tags=["characters"])
app.include_router(glossary.router, tags=["glossary"])
app.include_router(files.router, tags=["files"])
app.include_router(memory.router, tags=["memory"])
app.include_router(chatbot.router, tags=["chatbot"])
app.include_router(speakers.router, tags=["speakers"])


# ── Bot WebSocket (secured with shared secret) ──────────────────────────────

@app.websocket("/ws/bot")
async def ws_bot(ws: WebSocket):
    # Verify bot secret from query params
    secret = ws.query_params.get("secret")
    if secret != BOT_SECRET:
        await ws.close(code=4001, reason="Invalid bot secret")
        return

    await ws.accept()
    session_id = ws.query_params.get("session_id", "unknown")
    logger.info(f"Bot connected (bot session {session_id}, transcripts will route to active session dynamically)")

    pending_meta: dict | None = None

    try:
        while True:
            message = await ws.receive()

            if message["type"] == "websocket.receive":
                if "text" in message:
                    pending_meta = json.loads(message["text"])

                elif "bytes" in message and pending_meta is not None:
                    meta = pending_meta
                    pending_meta = None
                    pcm_data = message["bytes"]

                    from stt.vad_gate import process_audio_chunk
                    await process_audio_chunk(
                        session_id=session_id,
                        user_id=meta["user_id"],
                        display_name=meta["display_name"],
                        pcm_data=pcm_data,
                    )

            elif message["type"] == "websocket.disconnect":
                break

    except WebSocketDisconnect:
        pass
    finally:
        from stt.vad_gate import cleanup_session
        await cleanup_session(session_id)
        logger.info(f"Bot disconnected for session {session_id}")
