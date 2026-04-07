# Fablescribe Backend — Production image
# Build: docker build -t fablescribe-backend backend/
# Run:   docker run -p 8000:8000 --env-file backend/.env fablescribe-backend

FROM python:3.11-slim AS base

# Install build deps for native packages (psycopg, onnxruntime, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (cached layer)
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
      "fastapi>=0.115" \
      "uvicorn[standard]>=0.34" \
      "websockets>=14.0" \
      "psycopg[binary]>=3.2" \
      "python-dotenv>=1.0" \
      "deepgram-sdk>=3.9" \
      "silero-vad>=5.1" \
      "numpy>=1.26" \
      "onnxruntime>=1.19" \
      "supabase>=2.11" \
      "python-jose[cryptography]>=3.3" \
      "anthropic>=0.52" \
      "httpx>=0.27" \
      "qdrant-client>=1.12" \
      "nomic>=3.3" \
      "python-multipart>=0.0.18"

# Copy source
COPY . .

EXPOSE 8000

# Pre-warm Silero VAD model on first run (cached after that in /root/.cache)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=2).status == 200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
