import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_campaign_dm
from config import BOT_SECRET, BOT_HTTP_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import db
import vectorization

logger = logging.getLogger("fablescribe.campaigns")

router = APIRouter()


class CampaignCreate(BaseModel):
    name: str
    description: str | None = None
    discord_voice_channel_id: str | None = None


class CampaignUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    discord_voice_channel_id: str | None = None


@router.get("")
async def list_campaigns(user: dict = Depends(get_current_user)):
    return await db.fetch_all(
        """
        SELECT c.* FROM campaigns c
        JOIN campaign_members cm ON cm.campaign_id = c.id
        WHERE cm.user_id = %s
        ORDER BY c.created_at DESC
        """,
        (user["id"],),
    )


@router.post("", status_code=201)
async def create_campaign(body: CampaignCreate, user: dict = Depends(get_current_user)):
    return await db.execute_returning(
        """
        INSERT INTO campaigns (name, description, discord_voice_channel_id, created_by)
        VALUES (%s, %s, %s, %s)
        RETURNING *
        """,
        (body.name, body.description, body.discord_voice_channel_id, user["id"]),
    )


@router.get("/{campaign_id}")
async def get_campaign(campaign_id: str, user: dict = Depends(get_current_user)):
    await require_campaign_dm(user, campaign_id)
    return await db.fetch_one("SELECT * FROM campaigns WHERE id = %s", (campaign_id,))


@router.patch("/{campaign_id}")
async def update_campaign(
    campaign_id: str, body: CampaignUpdate, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    sets, vals = [], []
    if body.name is not None:
        sets.append("name = %s")
        vals.append(body.name)
    if body.description is not None:
        sets.append("description = %s")
        vals.append(body.description)
    if body.discord_voice_channel_id is not None:
        sets.append("discord_voice_channel_id = %s")
        vals.append(body.discord_voice_channel_id)
    if not sets:
        return await db.fetch_one("SELECT * FROM campaigns WHERE id = %s", (campaign_id,))
    vals.append(campaign_id)
    return await db.execute_returning(
        f"UPDATE campaigns SET {', '.join(sets)} WHERE id = %s RETURNING *",
        tuple(vals),
    )


@router.delete("/{campaign_id}", status_code=204)
async def delete_campaign(campaign_id: str, user: dict = Depends(get_current_user)):
    await require_campaign_dm(user, campaign_id)
    await db.execute("DELETE FROM campaigns WHERE id = %s", (campaign_id,))


# ── Reindex (one-time backfill for entries created before vectorization) ────

@router.post("/{campaign_id}/reindex")
async def reindex_campaign(campaign_id: str, user: dict = Depends(get_current_user)):
    """Re-vectorize all characters, glossary entries, and memory entries for this campaign.
    Use this to backfill entries created before vectorization was wired in,
    or after restoring from a backup."""
    await require_campaign_dm(user, campaign_id)

    counts = {"characters": 0, "glossary": 0, "memory": 0, "skipped": 0}

    # Characters
    chars = await db.fetch_all(
        "SELECT * FROM characters WHERE campaign_id = %s", (campaign_id,)
    )
    for c in chars:
        text_parts = [c.get("name", "")]
        if c.get("description"):
            text_parts.append(c["description"])
        if c.get("personality"):
            text_parts.append(f"Personality: {c['personality']}")
        if c.get("speech_notes"):
            text_parts.append(f"Speech: {c['speech_notes']}")
        text = "\n".join(text_parts).strip()
        if not text:
            counts["skipped"] += 1
            continue
        point_id = await vectorization.upsert_entry(
            "character", str(c["id"]), campaign_id, text,
            {"name": c["name"], "kind": c.get("kind", "npc")},
        )
        if point_id:
            await db.execute(
                "UPDATE characters SET qdrant_point_id = %s, vector_updated_at = now() WHERE id = %s",
                (point_id, c["id"]),
            )
            counts["characters"] += 1

    # Glossary
    glossary = await db.fetch_all(
        "SELECT * FROM glossary_entries WHERE campaign_id = %s", (campaign_id,)
    )
    for g in glossary:
        text_parts = [g.get("name", "")]
        if g.get("aliases"):
            text_parts.append(f"Also known as: {', '.join(g['aliases'])}")
        if g.get("description"):
            text_parts.append(g["description"])
        text = "\n".join(text_parts).strip()
        if not text:
            counts["skipped"] += 1
            continue
        point_id = await vectorization.upsert_entry(
            "glossary", str(g["id"]), campaign_id, text,
            {"name": g["name"], "type": g["type"]},
        )
        if point_id:
            await db.execute(
                "UPDATE glossary_entries SET qdrant_point_id = %s, vector_updated_at = now() WHERE id = %s",
                (point_id, g["id"]),
            )
            counts["glossary"] += 1

    # Memory entries (only non-deleted)
    memories = await db.fetch_all(
        """
        SELECT m.*, c.name as character_name
        FROM memory_entries m
        LEFT JOIN characters c ON c.id = m.character_id
        WHERE m.campaign_id = %s AND m.deleted_at IS NULL
        """,
        (campaign_id,),
    )
    for m in memories:
        # Build vectorization text based on kind
        if m["kind"] == "response":
            text = m.get("content") or m.get("final_text") or ""
        else:
            parts = []
            if m.get("dm_annotation"):
                parts.append(m["dm_annotation"])
            if m.get("content"):
                parts.append(m["content"])
            text = "\n".join(parts).strip()

        if not text:
            counts["skipped"] += 1
            continue

        # Resolve present character names for response entries
        present_names = []
        if m.get("present_character_ids"):
            present_chars = await db.fetch_all(
                "SELECT name FROM characters WHERE id = ANY(%s)",
                (m["present_character_ids"],),
            )
            present_names = [pc["name"] for pc in present_chars]

        payload = {"kind": m["kind"]}
        if m.get("character_name"):
            payload["character"] = m["character_name"]
        if present_names:
            payload["present_characters"] = present_names

        point_id = await vectorization.upsert_entry(
            "memory", str(m["id"]), campaign_id, text, payload,
        )
        if point_id:
            await db.execute(
                "UPDATE memory_entries SET qdrant_point_id = %s, vector_updated_at = now() WHERE id = %s",
                (point_id, m["id"]),
            )
            counts["memory"] += 1

    logger.info(f"Reindex complete for campaign {campaign_id}: {counts}")
    return counts


# ── Audio Queue ──────────────────────────────────────────────────────────────

@router.get("/{campaign_id}/audio-queue")
async def get_audio_queue(campaign_id: str, user: dict = Depends(get_current_user)):
    await require_campaign_dm(user, campaign_id)
    return await db.fetch_all(
        """
        SELECT id, final_text, character_id, queue_position, queue_status, audio_file_ref
        FROM memory_entries
        WHERE campaign_id = %s AND queue_status IN ('pending', 'playing')
        ORDER BY queue_position
        """,
        (campaign_id,),
    )


@router.post("/{campaign_id}/audio-queue/{entry_id}/play")
async def play_queue_item(
    campaign_id: str, entry_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)

    # Get the entry with audio ref
    entry = await db.fetch_one(
        "SELECT audio_file_ref FROM memory_entries WHERE id = %s AND campaign_id = %s",
        (entry_id, campaign_id),
    )
    if not entry or not entry.get("audio_file_ref"):
        raise HTTPException(400, "No audio file for this entry")

    # Get a signed URL for the audio
    async with httpx.AsyncClient() as client:
        sign_resp = await client.post(
            f"{SUPABASE_URL}/storage/v1/object/sign/response-audio/{entry['audio_file_ref']}",
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
            },
            json={"expiresIn": 300},
        )
    if sign_resp.status_code != 200:
        raise HTTPException(500, "Failed to sign audio URL")

    audio_url = f"{SUPABASE_URL}/storage/v1{sign_resp.json()['signedURL']}"

    # Mark as playing
    await db.execute(
        "UPDATE memory_entries SET queue_status = 'playing' WHERE id = %s",
        (entry_id,),
    )

    # Tell the bot to play
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{BOT_HTTP_URL}/play",
                headers={"Authorization": f"Bearer {BOT_SECRET}"},
                json={"guild_id": "any", "audio_url": audio_url},
                timeout=65.0,
            )
        if resp.status_code == 200 and resp.json().get("success"):
            await db.execute(
                "UPDATE memory_entries SET queue_status = 'played', played_at = now() WHERE id = %s",
                (entry_id,),
            )
        else:
            await db.execute(
                "UPDATE memory_entries SET queue_status = 'pending' WHERE id = %s",
                (entry_id,),
            )
    except Exception as e:
        logger.error(f"Bot play request failed: {e}")
        await db.execute(
            "UPDATE memory_entries SET queue_status = 'pending' WHERE id = %s",
            (entry_id,),
        )
        raise HTTPException(500, f"Bot playback failed: {str(e)}")

    return await db.fetch_one("SELECT * FROM memory_entries WHERE id = %s", (entry_id,))


@router.delete("/{campaign_id}/audio-queue/{entry_id}")
async def cancel_queue_item(
    campaign_id: str, entry_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    return await db.execute_returning(
        "UPDATE memory_entries SET queue_status = 'cancelled' WHERE id = %s RETURNING *",
        (entry_id,),
    )
