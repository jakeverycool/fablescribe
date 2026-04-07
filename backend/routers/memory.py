import logging

import anthropic
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user, require_campaign_dm
from config import ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from prompts.response import assemble_prompt
import db
import vectorization

logger = logging.getLogger("fablescribe.memory")

router = APIRouter()


class MemoryNoteCreate(BaseModel):
    session_id: str | None = None
    content: str
    selected_transcript_ids: list[str] = []
    dm_annotation: str | None = None
    linked_glossary_ids: list[str] = []
    visibility: str = "public"


class MemoryEventCreate(BaseModel):
    session_id: str | None = None
    content: str
    linked_glossary_ids: list[str] = []
    visibility: str = "public"


class MemoryUpdate(BaseModel):
    content: str | None = None
    dm_annotation: str | None = None
    linked_glossary_ids: list[str] | None = None
    visibility: str | None = None


@router.get("/campaigns/{campaign_id}/memory")
async def list_memory(
    campaign_id: str,
    session_id: str | None = None,
    kind: str | None = None,
    user: dict = Depends(get_current_user),
):
    await require_campaign_dm(user, campaign_id)

    query = """
        SELECT * FROM memory_entries
        WHERE campaign_id = %s AND deleted_at IS NULL
    """
    params: list = [campaign_id]

    if session_id:
        query += " AND session_id = %s"
        params.append(session_id)
    if kind:
        query += " AND kind = %s"
        params.append(kind)

    query += " ORDER BY COALESCE(source_timestamp, created_at)"
    return await db.fetch_all(query, tuple(params))


@router.post("/campaigns/{campaign_id}/memory/note", status_code=201)
async def create_note(
    campaign_id: str, body: MemoryNoteCreate, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)

    # Get source timestamp from earliest selected transcript
    source_ts = None
    if body.selected_transcript_ids:
        row = await db.fetch_one(
            "SELECT MIN(created_at) as ts FROM transcript_entries WHERE id = ANY(%s)",
            (body.selected_transcript_ids,),
        )
        if row:
            source_ts = row["ts"]

    row = await db.execute_returning(
        """
        INSERT INTO memory_entries
            (campaign_id, session_id, kind, visibility, source_timestamp,
             content, selected_transcript_ids, dm_annotation, linked_glossary_ids)
        VALUES (%s, %s, 'note', %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            campaign_id, body.session_id, body.visibility, source_ts,
            body.content, body.selected_transcript_ids, body.dm_annotation,
            body.linked_glossary_ids,
        ),
    )
    text = f"{body.dm_annotation or ''}\n{body.content}".strip()
    point_id = await vectorization.upsert_entry(
        "memory", str(row["id"]), campaign_id, text, {"kind": "note"},
    )
    if point_id:
        await db.execute(
            "UPDATE memory_entries SET qdrant_point_id = %s, vector_updated_at = now() WHERE id = %s",
            (point_id, row["id"]),
        )
    return row


@router.post("/campaigns/{campaign_id}/memory/event", status_code=201)
async def create_event(
    campaign_id: str, body: MemoryEventCreate, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    row = await db.execute_returning(
        """
        INSERT INTO memory_entries
            (campaign_id, session_id, kind, visibility, source_timestamp,
             content, linked_glossary_ids)
        VALUES (%s, %s, 'event', %s, now(), %s, %s)
        RETURNING *
        """,
        (
            campaign_id, body.session_id, body.visibility,
            body.content, body.linked_glossary_ids,
        ),
    )
    point_id = await vectorization.upsert_entry(
        "memory", str(row["id"]), campaign_id, body.content, {"kind": "event"},
    )
    if point_id:
        await db.execute(
            "UPDATE memory_entries SET qdrant_point_id = %s, vector_updated_at = now() WHERE id = %s",
            (point_id, row["id"]),
        )
    return row


@router.patch("/campaigns/{campaign_id}/memory/{entry_id}")
async def update_memory(
    campaign_id: str,
    entry_id: str,
    body: MemoryUpdate,
    user: dict = Depends(get_current_user),
):
    await require_campaign_dm(user, campaign_id)
    sets, vals = [], []
    if body.content is not None:
        sets.append("content = %s")
        vals.append(body.content)
    if body.dm_annotation is not None:
        sets.append("dm_annotation = %s")
        vals.append(body.dm_annotation)
    if body.linked_glossary_ids is not None:
        sets.append("linked_glossary_ids = %s")
        vals.append(body.linked_glossary_ids)
    if body.visibility is not None:
        sets.append("visibility = %s")
        vals.append(body.visibility)
    if not sets:
        return await db.fetch_one("SELECT * FROM memory_entries WHERE id = %s", (entry_id,))
    vals.append(entry_id)
    return await db.execute_returning(
        f"UPDATE memory_entries SET {', '.join(sets)} WHERE id = %s RETURNING *",
        tuple(vals),
    )


@router.delete("/campaigns/{campaign_id}/memory/{entry_id}", status_code=204)
async def delete_memory(
    campaign_id: str, entry_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    await vectorization.delete_entry(entry_id, "memory")
    await db.execute(
        "UPDATE memory_entries SET deleted_at = now() WHERE id = %s AND campaign_id = %s",
        (entry_id, campaign_id),
    )


# ── NPC Response Generation ─────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    selected_transcript_ids: list[str] = []
    character_id: str
    additional_context: str | None = None


class FinalizeRequest(BaseModel):
    selected_transcript_ids: list[str] = []
    character_id: str
    additional_context: str | None = None
    final_text: str
    session_id: str | None = None
    present_character_ids: list[str] = []


@router.post("/campaigns/{campaign_id}/memory/generate-response")
async def generate_response(
    campaign_id: str, body: GenerateRequest, user: dict = Depends(get_current_user)
):
    """Generate NPC dialogue with Claude. Returns text for DM review — nothing is saved yet."""
    await require_campaign_dm(user, campaign_id)

    system_prompt, user_prompt = await assemble_prompt(
        campaign_id=campaign_id,
        character_id=body.character_id,
        selected_transcript_ids=body.selected_transcript_ids,
        additional_context=body.additional_context,
    )

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    generated_text = message.content[0].text
    return {"generated_text": generated_text}


@router.post("/campaigns/{campaign_id}/memory/finalize-response", status_code=201)
async def finalize_response(
    campaign_id: str, body: FinalizeRequest, user: dict = Depends(get_current_user)
):
    """Save the response, generate TTS audio, and add to queue."""
    await require_campaign_dm(user, campaign_id)

    # Get character for voice ID and direction tag
    character = await db.fetch_one(
        "SELECT id, name, elevenlabs_voice_id, personality, speech_notes FROM characters WHERE id = %s",
        (body.character_id,),
    )
    if not character:
        raise HTTPException(404, "Character not found")

    # Get source timestamp
    source_ts = None
    if body.selected_transcript_ids:
        row = await db.fetch_one(
            "SELECT MIN(created_at) as ts FROM transcript_entries WHERE id = ANY(%s)",
            (body.selected_transcript_ids,),
        )
        if row:
            source_ts = row["ts"]

    # Get next queue position
    pos_row = await db.fetch_one(
        "SELECT COALESCE(MAX(queue_position), 0) + 1 as next_pos FROM memory_entries WHERE campaign_id = %s AND queue_status IN ('pending', 'playing')",
        (campaign_id,),
    )
    next_pos = pos_row["next_pos"] if pos_row else 1

    # Build full conversation text: selected transcript lines + character response
    conversation_parts = []
    if body.selected_transcript_ids:
        transcript_lines = await db.fetch_all(
            """
            SELECT speaker_display_name, text
            FROM transcript_entries WHERE id = ANY(%s)
            ORDER BY created_at
            """,
            (body.selected_transcript_ids,),
        )
        for line in transcript_lines:
            conversation_parts.append(f"{line['speaker_display_name']}: {line['text']}")

    conversation_parts.append("")  # blank line separator
    conversation_parts.append(f"{character['name']}: {body.final_text}")
    conversation_content = "\n".join(conversation_parts)

    # Generate TTS audio if character has a voice
    audio_file_ref = None
    tts_error: str | None = None
    if character.get("elevenlabs_voice_id"):
        try:
            audio_file_ref = await _generate_tts(
                campaign_id, body.final_text, character["elevenlabs_voice_id"], character
            )
        except httpx.HTTPStatusError as e:
            # ElevenLabs returns structured errors — extract them
            try:
                detail = e.response.json().get("detail", {})
                msg = detail.get("message") if isinstance(detail, dict) else str(detail)
                tts_error = f"ElevenLabs {e.response.status_code}: {msg or e.response.text[:200]}"
            except Exception:
                tts_error = f"ElevenLabs {e.response.status_code}: {e.response.text[:200]}"
            logger.error(f"TTS generation failed: {tts_error}")
        except Exception as e:
            tts_error = f"TTS error: {type(e).__name__}: {e}"
            logger.error(tts_error)

    # Resolve present character names for Qdrant payload
    # Always include the responding character in present_character_ids
    # (they're obviously present if they're speaking)
    present_ids = list(body.present_character_ids)
    if body.character_id not in present_ids:
        present_ids.append(body.character_id)

    present_names = []
    if present_ids:
        present_chars = await db.fetch_all(
            "SELECT name FROM characters WHERE id = ANY(%s)",
            (present_ids,),
        )
        present_names = [c["name"] for c in present_chars]

    # Create the memory entry with full conversation as content
    entry = await db.execute_returning(
        """
        INSERT INTO memory_entries
            (campaign_id, session_id, kind, visibility, source_timestamp,
             content, selected_transcript_ids, character_id, additional_context,
             generated_text, final_text, audio_file_ref,
             queue_position, queue_status, present_character_ids)
        VALUES (%s, %s, 'response', 'public', %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s)
        RETURNING *
        """,
        (
            campaign_id, body.session_id, source_ts,
            conversation_content, body.selected_transcript_ids, body.character_id,
            body.additional_context, body.final_text, body.final_text,
            audio_file_ref, next_pos, present_ids,
        ),
    )

    # Vectorize the full conversation — include present character names so
    # RAG retrieval can find this entry for characters who witnessed it
    point_id = await vectorization.upsert_entry(
        "memory", str(entry["id"]), campaign_id, conversation_content,
        {
            "kind": "response",
            "character": character["name"],
            "present_characters": present_names,
        },
    )
    if point_id:
        await db.execute(
            "UPDATE memory_entries SET qdrant_point_id = %s, vector_updated_at = now() WHERE id = %s",
            (point_id, entry["id"]),
        )

    # Track ElevenLabs usage
    char_count = len(body.final_text)
    await db.execute(
        "UPDATE users SET elevenlabs_chars_used_this_period = elevenlabs_chars_used_this_period + %s WHERE id = %s",
        (char_count, user["id"]),
    )

    # Attach TTS error (if any) so the frontend can surface it
    if tts_error:
        entry["tts_error"] = tts_error
    return entry


def _build_direction_tag(character: dict) -> str:
    """Build an ElevenLabs v3 audio direction tag from character personality and speech notes.

    Examples of output:
      [gruff, deep voice, speaks slowly with a Scottish accent]
      [nervous, high-pitched, stutters occasionally]
      [warm, maternal tone, speaks softly]
    """
    parts = []
    if character.get("speech_notes"):
        parts.append(character["speech_notes"].strip())
    if character.get("personality") and not character.get("speech_notes"):
        # Only use personality as fallback if no speech_notes
        parts.append(character["personality"].strip())

    if not parts:
        return ""

    tag_content = ", ".join(parts)
    # Keep it concise — long tags reduce effectiveness
    if len(tag_content) > 150:
        tag_content = tag_content[:150].rsplit(",", 1)[0]

    return f"[{tag_content}]"


async def _generate_tts(campaign_id: str, text: str, voice_id: str, character: dict) -> str:
    """Call ElevenLabs v3 with character direction tag and upload audio to Supabase Storage."""
    import uuid

    # Prepend character direction tag for v3 performance
    direction_tag = _build_direction_tag(character)
    tts_text = f"{direction_tag} {text}" if direction_tag else text

    logger.info(f"TTS input: {tts_text[:100]}...")

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            headers={
                "xi-api-key": ELEVENLABS_API_KEY,
                "Content-Type": "application/json",
            },
            json={
                "text": tts_text,
                "model_id": "eleven_v3",
                "output_format": "mp3_44100_128",
            },
        )
    resp.raise_for_status()
    audio_bytes = resp.content

    # Upload to Supabase Storage
    file_id = str(uuid.uuid4())
    storage_path = f"campaigns/{campaign_id}/responses/{file_id}.mp3"

    async with httpx.AsyncClient() as client:
        upload_resp = await client.post(
            f"{SUPABASE_URL}/storage/v1/object/response-audio/{storage_path}",
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Content-Type": "audio/mpeg",
            },
            content=audio_bytes,
        )
    upload_resp.raise_for_status()

    logger.info(f"TTS audio uploaded: {storage_path} ({len(audio_bytes)} bytes)")
    return storage_path
