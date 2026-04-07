import anthropic
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import get_current_user, require_campaign_dm
from config import ANTHROPIC_API_KEY
import db
import vectorization

router = APIRouter()


class ChatQuery(BaseModel):
    query: str


@router.post("/campaigns/{campaign_id}/chatbot")
async def chatbot_query(
    campaign_id: str, body: ChatQuery, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)

    # Search Qdrant for relevant entries
    hits = await vectorization.search(
        campaign_id=campaign_id,
        query=body.query,
        top_k=8,
    )

    if not hits:
        return {
            "answer": "I don't have any campaign memory to search yet. Add some memory entries, characters, or glossary entries first.",
            "sources": [],
        }

    # Build context from hits
    context_parts = []
    sources = []
    for hit in hits:
        payload = hit.get("payload", {})
        entry_type = payload.get("entry_type", "unknown")
        entry_id = payload.get("entry_id", "")
        text = payload.get("text", "")

        if text:
            label = f"[{entry_type}]"
            if payload.get("name"):
                label = f"[{entry_type}: {payload['name']}]"
            elif payload.get("kind"):
                label = f"[{entry_type}/{payload['kind']}]"

            context_parts.append(f"{label}\n{text}")
            sources.append({
                "entry_type": entry_type,
                "entry_id": entry_id,
                "score": hit.get("score", 0),
                "preview": text[:200],
            })

    retrieved_context = "\n\n".join(context_parts)

    system_prompt = (
        "You are a helpful campaign historian for a tabletop RPG. "
        "Answer the DM's question based only on the retrieved campaign memory below. "
        "If the answer isn't in the retrieved context, say so. "
        "Cite which entries you drew from by referencing their type and name/kind."
    )

    user_prompt = f"[Retrieved campaign memory]\n{retrieved_context}\n\nDM question: {body.query}"

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    answer = message.content[0].text
    return {"answer": answer, "sources": sources}
