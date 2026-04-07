"""Supabase JWT auth for FastAPI."""

import httpx
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import SUPABASE_URL, SUPABASE_ANON_KEY

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """Verify the Supabase JWT and return the user object.

    Uses Supabase's own /auth/v1/user endpoint to validate the token,
    which is simpler and more reliable than local JWT verification
    (no need to manage JWT secrets or JWKS rotation).
    """
    token = credentials.credentials

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": SUPABASE_ANON_KEY,
            },
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_data = resp.json()
    return {"id": user_data["id"], "email": user_data.get("email")}


async def require_campaign_dm(user: dict, campaign_id: str) -> None:
    """Raise 403 if the user is not a DM of the given campaign."""
    from db import fetch_one

    row = await fetch_one(
        """
        SELECT 1 FROM campaign_members
        WHERE campaign_id = %s AND user_id = %s AND campaign_role = 'dm'
        """,
        (campaign_id, user["id"]),
    )
    if not row:
        raise HTTPException(status_code=403, detail="Not a DM of this campaign")
