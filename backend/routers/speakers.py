from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import get_current_user, require_campaign_dm
import db

router = APIRouter()


class SpeakerUpdate(BaseModel):
    role: str | None = None  # 'dm', 'player', 'unknown'
    character_id: str | None = None


@router.get("/campaigns/{campaign_id}/speakers")
async def list_speakers(campaign_id: str, user: dict = Depends(get_current_user)):
    await require_campaign_dm(user, campaign_id)
    return await db.fetch_all(
        """
        SELECT s.*, c.name as character_name
        FROM campaign_speakers s
        LEFT JOIN characters c ON c.id = s.character_id
        WHERE s.campaign_id = %s
        ORDER BY s.discord_display_name
        """,
        (campaign_id,),
    )


@router.patch("/campaigns/{campaign_id}/speakers/{speaker_id}")
async def update_speaker(
    campaign_id: str,
    speaker_id: str,
    body: SpeakerUpdate,
    user: dict = Depends(get_current_user),
):
    await require_campaign_dm(user, campaign_id)

    # If marking as DM, unset any existing DM in this campaign first (only one DM allowed)
    if body.role == "dm":
        await db.execute(
            "UPDATE campaign_speakers SET role = 'unknown' WHERE campaign_id = %s AND role = 'dm' AND id != %s",
            (campaign_id, speaker_id),
        )

    sets, vals = [], []
    if body.role is not None:
        sets.append("role = %s")
        vals.append(body.role)
    if body.character_id is not None:
        # Empty string means clear the assignment
        sets.append("character_id = %s")
        vals.append(body.character_id if body.character_id else None)

    if not sets:
        return await db.fetch_one("SELECT * FROM campaign_speakers WHERE id = %s", (speaker_id,))

    sets.append("updated_at = now()")
    vals.append(speaker_id)
    return await db.execute_returning(
        f"UPDATE campaign_speakers SET {', '.join(sets)} WHERE id = %s RETURNING *",
        tuple(vals),
    )
