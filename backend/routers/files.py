import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from auth import get_current_user, require_campaign_dm
from config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import db
import httpx

router = APIRouter()

ALLOWED_EXTENSIONS = {".docx", ".txt", ".md", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp"}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB

MIME_TO_KIND = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
    "text/markdown": "md",
    "application/pdf": "pdf",
    "image/png": "image",
    "image/jpeg": "image",
    "image/gif": "image",
    "image/webp": "image",
}


class FileUpdate(BaseModel):
    display_name: str | None = None
    description: str | None = None
    tags: list[str] | None = None


@router.get("/campaigns/{campaign_id}/files")
async def list_files(campaign_id: str, user: dict = Depends(get_current_user)):
    await require_campaign_dm(user, campaign_id)
    return await db.fetch_all(
        "SELECT * FROM campaign_files WHERE campaign_id = %s ORDER BY created_at DESC",
        (campaign_id,),
    )


@router.post("/campaigns/{campaign_id}/files", status_code=201)
async def upload_file(
    campaign_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    await require_campaign_dm(user, campaign_id)

    # Validate extension
    filename = file.filename or "unknown"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"File type {ext} not allowed")

    # Read and validate size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File too large (max {MAX_FILE_SIZE // 1024 // 1024} MB)")

    file_id = str(uuid.uuid4())
    storage_path = f"campaigns/{campaign_id}/files/{file_id}/{filename}"
    mime_type = file.content_type or "application/octet-stream"
    file_kind = MIME_TO_KIND.get(mime_type, "other")

    # Upload to Supabase Storage
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}/storage/v1/object/campaign-files/{storage_path}",
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Content-Type": mime_type,
            },
            content=content,
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(500, f"Storage upload failed: {resp.text}")

    return await db.execute_returning(
        """
        INSERT INTO campaign_files
            (id, campaign_id, uploaded_by, filename, display_name, mime_type,
             file_size_bytes, storage_path, file_kind)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (file_id, campaign_id, user["id"], filename, filename, mime_type,
         len(content), storage_path, file_kind),
    )


@router.patch("/campaigns/{campaign_id}/files/{file_id}")
async def update_file(
    campaign_id: str,
    file_id: str,
    body: FileUpdate,
    user: dict = Depends(get_current_user),
):
    await require_campaign_dm(user, campaign_id)
    sets, vals = [], []
    if body.display_name is not None:
        sets.append("display_name = %s")
        vals.append(body.display_name)
    if body.description is not None:
        sets.append("description = %s")
        vals.append(body.description)
    if body.tags is not None:
        sets.append("tags = %s")
        vals.append(body.tags)
    if not sets:
        return await db.fetch_one("SELECT * FROM campaign_files WHERE id = %s", (file_id,))
    vals.append(file_id)
    return await db.execute_returning(
        f"UPDATE campaign_files SET {', '.join(sets)} WHERE id = %s RETURNING *",
        tuple(vals),
    )


@router.delete("/campaigns/{campaign_id}/files/{file_id}", status_code=204)
async def delete_file(
    campaign_id: str, file_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)

    row = await db.fetch_one("SELECT storage_path FROM campaign_files WHERE id = %s", (file_id,))
    if row:
        async with httpx.AsyncClient() as client:
            await client.delete(
                f"{SUPABASE_URL}/storage/v1/object/campaign-files/{row['storage_path']}",
                headers={
                    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                },
            )
    await db.execute("DELETE FROM campaign_files WHERE id = %s", (file_id,))


@router.get("/campaigns/{campaign_id}/files/{file_id}/download")
async def download_file(
    campaign_id: str, file_id: str, user: dict = Depends(get_current_user)
):
    await require_campaign_dm(user, campaign_id)

    row = await db.fetch_one("SELECT storage_path FROM campaign_files WHERE id = %s", (file_id,))
    if not row:
        raise HTTPException(404, "File not found")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{SUPABASE_URL}/storage/v1/object/sign/campaign-files/{row['storage_path']}",
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
            },
            json={"expiresIn": 3600},
        )

    if resp.status_code != 200:
        raise HTTPException(500, "Failed to generate download URL")

    data = resp.json()
    return {"url": f"{SUPABASE_URL}/storage/v1{data['signedURL']}"}
