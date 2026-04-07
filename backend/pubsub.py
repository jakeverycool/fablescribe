"""In-memory pub/sub for broadcasting transcript entries to dashboard WebSocket clients."""

import asyncio
import json
from weakref import WeakSet

from fastapi import WebSocket

_dashboard_clients: WeakSet[WebSocket] = WeakSet()
_lock = asyncio.Lock()


async def add_dashboard_client(ws: WebSocket) -> None:
    async with _lock:
        _dashboard_clients.add(ws)


async def remove_dashboard_client(ws: WebSocket) -> None:
    async with _lock:
        _dashboard_clients.discard(ws)


async def broadcast_transcript(entry: dict) -> None:
    """Send a transcript entry to all connected dashboard clients."""
    # Serialize once, send to all
    payload = json.dumps(
        {
            "type": "transcript",
            "data": {
                "id": str(entry["id"]),
                "session_id": entry["session_id"],
                "speaker_user_id": entry["speaker_user_id"],
                "speaker_display_name": entry["speaker_display_name"],
                "text": entry["text"],
                "segment_start_ts": (
                    entry["segment_start_ts"].isoformat()
                    if entry.get("segment_start_ts")
                    else None
                ),
                "segment_end_ts": (
                    entry["segment_end_ts"].isoformat()
                    if entry.get("segment_end_ts")
                    else None
                ),
                "created_at": entry["created_at"].isoformat(),
            },
        }
    )

    async with _lock:
        dead: list[WebSocket] = []
        for client in _dashboard_clients:
            try:
                await client.send_text(payload)
            except Exception:
                dead.append(client)
        for client in dead:
            _dashboard_clients.discard(client)
