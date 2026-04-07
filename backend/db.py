"""Database access via Supabase's Postgres (direct connection with psycopg)."""

import psycopg
from psycopg.rows import dict_row

from config import SUPABASE_DB_URL

_pool: psycopg.AsyncConnection | None = None


async def get_conn() -> psycopg.AsyncConnection:
    global _pool
    if _pool is None or _pool.closed:
        _pool = await psycopg.AsyncConnection.connect(
            SUPABASE_DB_URL, row_factory=dict_row, autocommit=True
        )
    return _pool


async def close_conn() -> None:
    global _pool
    if _pool and not _pool.closed:
        await _pool.close()
        _pool = None


async def fetch_one(query: str, params: tuple = ()) -> dict | None:
    conn = await get_conn()
    cur = await conn.execute(query, params)
    return await cur.fetchone()


async def fetch_all(query: str, params: tuple = ()) -> list[dict]:
    conn = await get_conn()
    cur = await conn.execute(query, params)
    return await cur.fetchall()


async def execute(query: str, params: tuple = ()) -> None:
    conn = await get_conn()
    await conn.execute(query, params)


async def execute_returning(query: str, params: tuple = ()) -> dict | None:
    conn = await get_conn()
    cur = await conn.execute(query, params)
    return await cur.fetchone()
