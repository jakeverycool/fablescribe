from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import get_current_user, require_campaign_dm
import db

router = APIRouter()


class SessionCreate(BaseModel):
    title: str | None = None


class SessionUpdate(BaseModel):
    title: str | None = None
    dm_session_notes: str | None = None


@router.get("/campaigns/{campaign_id}/sessions")
async def list_sessions(campaign_id: str, user: dict = Depends(get_current_user)):
    await require_campaign_dm(user, campaign_id)
    return await db.fetch_all(
        "SELECT * FROM sessions WHERE campaign_id = %s ORDER BY started_at DESC NULLS LAST",
        (campaign_id,),
    )


@router.post("/campaigns/{campaign_id}/sessions", status_code=201)
async def create_session(
    campaign_id: str, body: SessionCreate, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    return await db.execute_returning(
        """
        INSERT INTO sessions (campaign_id, title, status, started_at)
        VALUES (%s, %s, 'active', now())
        RETURNING *
        """,
        (campaign_id, body.title),
    )


@router.patch("/campaigns/{campaign_id}/sessions/{session_id}")
async def update_session(
    campaign_id: str,
    session_id: str,
    body: SessionUpdate,
    user: dict = Depends(get_current_user),
):
    await require_campaign_dm(user, campaign_id)
    sets, vals = [], []
    if body.title is not None:
        sets.append("title = %s")
        vals.append(body.title)
    if body.dm_session_notes is not None:
        sets.append("dm_session_notes = %s")
        vals.append(body.dm_session_notes)
    if not sets:
        return await db.fetch_one("SELECT * FROM sessions WHERE id = %s", (session_id,))
    vals.append(session_id)
    return await db.execute_returning(
        f"UPDATE sessions SET {', '.join(sets)} WHERE id = %s RETURNING *",
        tuple(vals),
    )


@router.post("/campaigns/{campaign_id}/sessions/{session_id}/start")
async def start_session(
    campaign_id: str, session_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    return await db.execute_returning(
        "UPDATE sessions SET status = 'active', started_at = now(), paused = false WHERE id = %s RETURNING *",
        (session_id,),
    )


@router.post("/campaigns/{campaign_id}/sessions/{session_id}/end")
async def end_session(
    campaign_id: str, session_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    return await db.execute_returning(
        "UPDATE sessions SET status = 'ended', ended_at = now(), paused = false WHERE id = %s RETURNING *",
        (session_id,),
    )


@router.post("/campaigns/{campaign_id}/sessions/{session_id}/pause")
async def pause_session(
    campaign_id: str, session_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    return await db.execute_returning(
        "UPDATE sessions SET paused = true WHERE id = %s RETURNING *",
        (session_id,),
    )


@router.post("/campaigns/{campaign_id}/sessions/{session_id}/resume")
async def resume_session(
    campaign_id: str, session_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    return await db.execute_returning(
        "UPDATE sessions SET paused = false WHERE id = %s RETURNING *",
        (session_id,),
    )


@router.get("/campaigns/{campaign_id}/sessions/{session_id}/transcript")
async def get_transcript(
    campaign_id: str, session_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    return await db.fetch_all(
        "SELECT * FROM transcript_entries WHERE session_id = %s ORDER BY created_at",
        (session_id,),
    )
