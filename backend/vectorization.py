"""Qdrant vectorization service using Nomic Embed via API."""

import logging
import uuid

import httpx
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    PointStruct,
    VectorParams,
    Filter,
    FieldCondition,
    MatchValue,
)

from config import QDRANT_URL, QDRANT_API_KEY, NOMIC_API_KEY

logger = logging.getLogger("fablescribe.vectorization")

COLLECTION_NAME = "fablescribe_campaign_memory"
VECTOR_SIZE = 768  # Nomic Embed v1.5

_qdrant: QdrantClient | None = None


def get_qdrant() -> QdrantClient:
    global _qdrant
    if _qdrant is None:
        _qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
        _ensure_collection()
    return _qdrant


def _ensure_collection() -> None:
    client = get_qdrant()
    collections = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME not in collections:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )
        client.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name="campaign_id",
            field_schema="keyword",
        )
        client.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name="entry_type",
            field_schema="keyword",
        )
        logger.info(f"Created Qdrant collection '{COLLECTION_NAME}'")


async def embed_text(text: str) -> list[float]:
    """Get embeddings from Nomic API."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api-atlas.nomic.ai/v1/embedding/text",
            headers={
                "Authorization": f"Bearer {NOMIC_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "texts": [text],
                "model": "nomic-embed-text-v1.5",
                "task_type": "search_document",
            },
            timeout=30.0,
        )
    resp.raise_for_status()
    return resp.json()["embeddings"][0]


async def embed_query(text: str) -> list[float]:
    """Get query embeddings (uses search_query task type for better retrieval)."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api-atlas.nomic.ai/v1/embedding/text",
            headers={
                "Authorization": f"Bearer {NOMIC_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "texts": [text],
                "model": "nomic-embed-text-v1.5",
                "task_type": "search_query",
            },
            timeout=30.0,
        )
    resp.raise_for_status()
    return resp.json()["embeddings"][0]


async def upsert_entry(
    entry_type: str,
    entry_id: str,
    campaign_id: str,
    text: str,
    metadata: dict | None = None,
) -> str:
    """Vectorize and upsert an entry to Qdrant. Returns the point ID."""
    if not text or not text.strip():
        logger.warning(f"Skipping vectorization of empty text for {entry_type}/{entry_id}")
        return ""

    vector = await embed_text(text)
    point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{entry_type}:{entry_id}"))

    payload = {
        "entry_type": entry_type,
        "entry_id": entry_id,
        "campaign_id": campaign_id,
        "text": text[:2000],  # Store truncated text for retrieval display
        **(metadata or {}),
    }

    client = get_qdrant()
    client.upsert(
        collection_name=COLLECTION_NAME,
        points=[PointStruct(id=point_id, vector=vector, payload=payload)],
    )

    logger.info(f"Upserted {entry_type}/{entry_id} to Qdrant (point {point_id})")
    return point_id


async def delete_entry(entry_id: str, entry_type: str) -> None:
    """Remove an entry from Qdrant."""
    point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{entry_type}:{entry_id}"))
    client = get_qdrant()
    client.delete(
        collection_name=COLLECTION_NAME,
        points_selector=[point_id],
    )
    logger.info(f"Deleted {entry_type}/{entry_id} from Qdrant")


async def search(
    campaign_id: str,
    query: str,
    top_k: int = 8,
    entry_type_filter: str | None = None,
) -> list[dict]:
    """Search Qdrant for similar entries in a campaign."""
    vector = await embed_query(query)

    must_conditions = [
        FieldCondition(key="campaign_id", match=MatchValue(value=campaign_id))
    ]
    if entry_type_filter:
        must_conditions.append(
            FieldCondition(key="entry_type", match=MatchValue(value=entry_type_filter))
        )

    client = get_qdrant()
    results = client.query_points(
        collection_name=COLLECTION_NAME,
        query=vector,
        query_filter=Filter(must=must_conditions),
        limit=top_k,
        with_payload=True,
    )

    return [
        {
            "id": str(hit.id),
            "score": hit.score,
            "payload": hit.payload,
        }
        for hit in results.points
    ]
