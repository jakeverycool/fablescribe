"""Per-speaker Deepgram streaming STT client using raw WebSocket.

Uses websockets library directly rather than the Deepgram SDK, since the
SDK's streaming API has breaking changes across major versions. The raw
WebSocket approach is simpler and more stable.
"""

import asyncio
import json
import logging
import time
import urllib.parse
from typing import Callable, Awaitable

import websockets

from config import DEEPGRAM_API_KEY

logger = logging.getLogger("fablescribe.stt.deepgram")

DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen"
CONNECTION_IDLE_TIMEOUT_S = 30.0


class SpeakerStream:
    """Manages a single Deepgram streaming WebSocket for one speaker."""

    def __init__(
        self,
        session_id: str,
        user_id: str,
        display_name: str,
        on_transcript: Callable[[str, str, str, str, float, float], Awaitable[None]],
        keyterms: list[str] | None = None,
    ):
        self.session_id = session_id
        self.user_id = user_id
        self.display_name = display_name
        self.on_transcript = on_transcript
        self.keyterms = keyterms or []

        self._ws: websockets.WebSocketClientProtocol | None = None
        self._receive_task: asyncio.Task | None = None
        self._last_audio_time = time.monotonic()
        self._closed = False

    async def start(self) -> None:
        """Open the Deepgram streaming WebSocket connection."""
        params = {
            "model": "nova-3",
            "language": "en",
            "encoding": "linear16",
            "sample_rate": "16000",
            "channels": "1",
            "interim_results": "true",
            "smart_format": "true",
            "punctuate": "true",
        }

        # Add keyterms as repeated query params
        query_parts = urllib.parse.urlencode(params)
        for term in self.keyterms[:100]:  # Deepgram limit
            query_parts += f"&keyterm={urllib.parse.quote(term)}"

        url = f"{DEEPGRAM_WS_URL}?{query_parts}"

        headers = {"Authorization": f"Token {DEEPGRAM_API_KEY}"}

        self._ws = await websockets.connect(url, additional_headers=headers)
        self._receive_task = asyncio.create_task(self._receive_loop())

        logger.info(
            f"Deepgram stream opened for user {self.user_id} in session {self.session_id}"
        )

    async def _receive_loop(self) -> None:
        """Read transcript events from Deepgram."""
        try:
            async for message in self._ws:
                if self._closed:
                    break

                try:
                    data = json.loads(message)
                except json.JSONDecodeError:
                    continue

                msg_type = data.get("type")
                if msg_type != "Results":
                    continue

                channel = data.get("channel", {})
                alternatives = channel.get("alternatives", [])
                if not alternatives:
                    continue

                transcript = alternatives[0].get("transcript", "").strip()
                if not transcript:
                    continue

                is_final = data.get("is_final", False)
                if not is_final:
                    continue

                start_ts = data.get("start", 0.0)
                duration = data.get("duration", 0.0)
                end_ts = start_ts + duration

                await self.on_transcript(
                    self.session_id,
                    self.user_id,
                    self.display_name,
                    transcript,
                    start_ts,
                    end_ts,
                )

        except websockets.ConnectionClosed:
            logger.debug(f"Deepgram connection closed for {self.user_id}")
        except Exception as e:
            if not self._closed:
                logger.error(f"Deepgram receive error for {self.user_id}: {e}")

    async def send_audio(self, pcm_data: bytes) -> None:
        """Send a chunk of 16kHz mono 16-bit PCM to Deepgram."""
        if self._ws and not self._closed:
            self._last_audio_time = time.monotonic()
            try:
                await self._ws.send(pcm_data)
            except websockets.ConnectionClosed:
                logger.debug(f"Send failed — connection closed for {self.user_id}")
                self._closed = True

    @property
    def idle_seconds(self) -> float:
        return time.monotonic() - self._last_audio_time

    async def close(self) -> None:
        """Close the Deepgram connection."""
        if self._closed:
            return
        self._closed = True

        if self._ws:
            try:
                # Send close message per Deepgram protocol
                await self._ws.send(json.dumps({"type": "CloseStream"}))
                await self._ws.close()
            except Exception as e:
                logger.warning(f"Error closing Deepgram for {self.user_id}: {e}")

        if self._receive_task and not self._receive_task.done():
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass

        logger.info(f"Deepgram stream closed for user {self.user_id}")


class DeepgramManager:
    """Manages per-(session, user) Deepgram streaming connections."""

    def __init__(self):
        self._streams: dict[tuple[str, str], SpeakerStream] = {}

    async def get_or_create_stream(
        self,
        session_id: str,
        user_id: str,
        display_name: str,
        on_transcript: Callable[[str, str, str, str, float, float], Awaitable[None]],
        keyterms: list[str] | None = None,
    ) -> SpeakerStream:
        key = (session_id, user_id)
        stream = self._streams.get(key)

        if stream and stream._closed:
            del self._streams[key]
            stream = None

        if stream is None:
            stream = SpeakerStream(
                session_id=session_id,
                user_id=user_id,
                display_name=display_name,
                on_transcript=on_transcript,
                keyterms=keyterms,
            )
            await stream.start()
            self._streams[key] = stream

        return stream

    async def close_stream(self, session_id: str, user_id: str) -> None:
        key = (session_id, user_id)
        stream = self._streams.pop(key, None)
        if stream:
            await stream.close()

    async def close_session(self, session_id: str) -> None:
        keys_to_remove = [k for k in self._streams if k[0] == session_id]
        for key in keys_to_remove:
            stream = self._streams.pop(key)
            await stream.close()

    async def close_all(self) -> None:
        for stream in self._streams.values():
            await stream.close()
        self._streams.clear()


# Module-level singleton
deepgram_manager = DeepgramManager()
