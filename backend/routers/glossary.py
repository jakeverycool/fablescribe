from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import get_current_user, require_campaign_dm
import db
import vectorization

router = APIRouter()


def _glossary_text(g: dict) -> str:
    parts = [g.get("name", "")]
    if g.get("aliases"):
        parts.append(f"Also known as: {', '.join(g['aliases'])}")
    if g.get("description"):
        parts.append(g["description"])
    return "\n".join(parts)


class GlossaryCreate(BaseModel):
    name: str
    type: str = "other"
    aliases: list[str] = []
    description: str | None = None
    known_by_character_ids: list[str] = []
    linked_entry_ids: list[str] = []
    tags: list[str] = []


class GlossaryUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    aliases: list[str] | None = None
    description: str | None = None
    known_by_character_ids: list[str] | None = None
    linked_entry_ids: list[str] | None = None
    tags: list[str] | None = None


@router.get("/campaigns/{campaign_id}/glossary")
async def list_glossary(campaign_id: str, user: dict = Depends(get_current_user)):
    await require_campaign_dm(user, campaign_id)
    return await db.fetch_all(
        "SELECT * FROM glossary_entries WHERE campaign_id = %s ORDER BY name",
        (campaign_id,),
    )


@router.post("/campaigns/{campaign_id}/glossary", status_code=201)
async def create_glossary_entry(
    campaign_id: str, body: GlossaryCreate, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    row = await db.execute_returning(
        """
        INSERT INTO glossary_entries
            (campaign_id, name, type, aliases, description,
             known_by_character_ids, linked_entry_ids, tags)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            campaign_id, body.name, body.type, body.aliases, body.description,
            body.known_by_character_ids, body.linked_entry_ids, body.tags,
        ),
    )
    point_id = await vectorization.upsert_entry(
        "glossary", str(row["id"]), campaign_id, _glossary_text(row),
        {"name": row["name"], "type": row["type"]},
    )
    if point_id:
        await db.execute(
            "UPDATE glossary_entries SET qdrant_point_id = %s, vector_updated_at = now() WHERE id = %s",
            (point_id, row["id"]),
        )
    return row


@router.get("/campaigns/{campaign_id}/glossary/{entry_id}")
async def get_glossary_entry(
    campaign_id: str, entry_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    return await db.fetch_one(
        "SELECT * FROM glossary_entries WHERE id = %s AND campaign_id = %s",
        (entry_id, campaign_id),
    )


@router.patch("/campaigns/{campaign_id}/glossary/{entry_id}")
async def update_glossary_entry(
    campaign_id: str,
    entry_id: str,
    body: GlossaryUpdate,
    user: dict = Depends(get_current_user),
):
    await require_campaign_dm(user, campaign_id)
    sets, vals = [], []
    for field in ["name", "description"]:
        val = getattr(body, field)
        if val is not None:
            sets.append(f"{field} = %s")
            vals.append(val)
    if body.type is not None:
        sets.append("type = %s")
        vals.append(body.type)
    for arr_field in ["aliases", "known_by_character_ids", "linked_entry_ids", "tags"]:
        val = getattr(body, arr_field)
        if val is not None:
            sets.append(f"{arr_field} = %s")
            vals.append(val)
    if not sets:
        return await db.fetch_one("SELECT * FROM glossary_entries WHERE id = %s", (entry_id,))
    vals.append(entry_id)
    row = await db.execute_returning(
        f"UPDATE glossary_entries SET {', '.join(sets)} WHERE id = %s RETURNING *",
        tuple(vals),
    )
    point_id = await vectorization.upsert_entry(
        "glossary", str(row["id"]), campaign_id, _glossary_text(row),
        {"name": row["name"], "type": row["type"]},
    )
    if point_id:
        await db.execute(
            "UPDATE glossary_entries SET qdrant_point_id = %s, vector_updated_at = now() WHERE id = %s",
            (point_id, row["id"]),
        )
    return row


@router.delete("/campaigns/{campaign_id}/glossary/{entry_id}", status_code=204)
async def delete_glossary_entry(
    campaign_id: str, entry_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)
    await vectorization.delete_entry(entry_id, "glossary")
    await db.execute("DELETE FROM glossary_entries WHERE id = %s AND campaign_id = %s",
                     (entry_id, campaign_id))
