import os
from dotenv import load_dotenv

load_dotenv()

# Environment label (dev / prod) — used for logging and behavior gates
ENV: str = os.environ.get("ENV", "local")

# Supabase
SUPABASE_URL: str = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY: str = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_ROLE_KEY: str = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SUPABASE_DB_URL: str = os.environ["SUPABASE_DB_URL"]

# External APIs
DEEPGRAM_API_KEY: str = os.environ["DEEPGRAM_API_KEY"]
ANTHROPIC_API_KEY: str = os.environ["ANTHROPIC_API_KEY"]
ELEVENLABS_API_KEY: str = os.environ["ELEVENLABS_API_KEY"]
NOMIC_API_KEY: str = os.environ["NOMIC_API_KEY"]

# Qdrant
QDRANT_URL: str = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY: str | None = os.environ.get("QDRANT_API_KEY") or None

# Bot shared secret
BOT_SECRET: str = os.environ.get("BOT_SECRET", "fablescribe-bot-secret-phase1")
BOT_HTTP_URL: str = os.environ.get("BOT_HTTP_URL", "http://127.0.0.1:3001")

# Supabase JWT settings
SUPABASE_JWT_SECRET: str = os.environ.get("SUPABASE_JWT_SECRET", "")

# CORS allowed origins — comma-separated list, plus a regex fallback for local dev
# Example: ALLOWED_ORIGINS="https://fablescribe.io,https://www.fablescribe.io"
_origins_raw = os.environ.get("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _origins_raw.split(",") if o.strip()]

# Default LAN/localhost regex used when ALLOWED_ORIGINS is empty (local dev)
LOCAL_ORIGIN_REGEX: str = (
    r"http://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|"
    r"172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+):\d+"
)
