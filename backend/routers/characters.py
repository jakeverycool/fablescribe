from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import get_current_user, require_campaign_dm
import db
import vectorization

router = APIRouter()


def _character_text(c: dict) -> str:
    parts = [c.get("name", "")]
    if c.get("description"):
        parts.append(c["description"])
    if c.get("personality"):
        parts.append(f"Personality: {c['personality']}")
    if c.get("speech_notes"):
        parts.append(f"Speech: {c['speech_notes']}")
    return "\n".join(parts)


class CharacterCreate(BaseModel):
    name: str
    kind: str = "npc"  # 'npc' or 'pc'
    description: str | None = None
    personality: str | None = None
    speech_notes: str | None = None
    elevenlabs_voice_id: str | None = None
    secrets: str | None = None
    linked_glossary_ids: list[str] = []


class CharacterUpdate(BaseModel):
    name: str | None = None
    kind: str | None = None
    description: str | None = None
    personality: str | None = None
    speech_notes: str | None = None
    elevenlabs_voice_id: str | None = None
    secrets: str | None = None
    linked_glossary_ids: list[str] | None = None


@router.get("/campaigns/{campaign_id}/characters")
async def list_characters(
    campaign_id: str,
    kind: str | None = None,
    user: dict = Depends(get_current_user),
):
    await require_campaign_dm(user, campaign_id)
    if kind:
        return await db.fetch_all(
            "SELECT * FROM characters WHERE campaign_id = %s AND kind = %s ORDER BY name",
            (campaign_id, kind),
        )
    return await db.fetch_all(
        "SELECT * FROM characters WHERE campaign_id = %s ORDER BY name",
        (campaign_id,),
    )


@router.post("/campaigns/{campaign_id}/characters", status_code=201)
async def create_character(
    campaign_id: str, body: CharacterCreate, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    row = await db.execute_returning(
        """
        INSERT INTO characters
            (campaign_id, name, kind, description, personality, speech_notes,
             elevenlabs_voice_id, secrets, linked_glossary_ids)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            campaign_id, body.name, body.kind, body.description, body.personality,
            body.speech_notes, body.elevenlabs_voice_id, body.secrets,
            body.linked_glossary_ids,
        ),
    )
    point_id = await vectorization.upsert_entry(
        "character", str(row["id"]), campaign_id, _character_text(row),
        {"name": row["name"]},
    )
    if point_id:
        await db.execute(
            "UPDATE characters SET qdrant_point_id = %s, vector_updated_at = now() WHERE id = %s",
            (point_id, row["id"]),
        )
    return row


@router.get("/campaigns/{campaign_id}/characters/{character_id}")
async def get_character(
    campaign_id: str, character_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    return await db.fetch_one(
        "SELECT * FROM characters WHERE id = %s AND campaign_id = %s",
        (character_id, campaign_id),
    )


@router.patch("/campaigns/{campaign_id}/characters/{character_id}")
async def update_character(
    campaign_id: str,
    character_id: str,
    body: CharacterUpdate,
    user: dict = Depends(get_current_user),
):
    await require_campaign_dm(user, campaign_id)
    sets, vals = [], []
    for field in ["name", "kind", "description", "personality", "speech_notes",
                  "elevenlabs_voice_id", "secrets"]:
        val = getattr(body, field)
        if val is not None:
            sets.append(f"{field} = %s")
            vals.append(val)
    if body.linked_glossary_ids is not None:
        sets.append("linked_glossary_ids = %s")
        vals.append(body.linked_glossary_ids)
    if not sets:
        return await db.fetch_one("SELECT * FROM characters WHERE id = %s", (character_id,))
    vals.append(character_id)
    row = await db.execute_returning(
        f"UPDATE characters SET {', '.join(sets)} WHERE id = %s RETURNING *",
        tuple(vals),
    )
    point_id = await vectorization.upsert_entry(
        "character", str(row["id"]), campaign_id, _character_text(row),
        {"name": row["name"]},
    )
    if point_id:
        await db.execute(
            "UPDATE characters SET qdrant_point_id = %s, vector_updated_at = now() WHERE id = %s",
            (point_id, row["id"]),
        )
    return row


@router.delete("/campaigns/{campaign_id}/characters/{character_id}", status_code=204)
async def delete_character(
    campaign_id: str, character_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    await vectorization.delete_entry(character_id, "character")
    await db.execute("DELETE FROM characters WHERE id = %s AND campaign_id = %s",
                     (character_id, campaign_id))
