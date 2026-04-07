#!/usr/bin/env bash
# Fablescribe — Server-side deploy script
# Runs on each Hetzner box. Pulls the latest images and restarts services.
#
# Usage:  ./deploy.sh [image_tag]
# Default image_tag: latest
#
# Called by GitHub Actions over SSH after a successful image build.

set -euo pipefail

DEPLOY_DIR="/opt/fablescribe"
IMAGE_TAG="${1:-latest}"

cd "$DEPLOY_DIR"

echo "==> Pulling images (tag: $IMAGE_TAG)"
IMAGE_TAG="$IMAGE_TAG" docker compose pull

echo "==> Restarting services"
IMAGE_TAG="$IMAGE_TAG" docker compose up -d --remove-orphans

echo "==> Pruning old images"
docker image prune -f

echo "==> Health check"
sleep 5
for i in 1 2 3 4 5 6; do
  if curl -fsS "http://localhost/health" -H "Host: ${API_DOMAIN:-localhost}" > /dev/null 2>&1; then
    echo "✓ Backend is healthy"
    exit 0
  fi
  echo "  waiting for backend... ($i/6)"
  sleep 5
done

echo "✗ Backend did not become healthy within 30s"
docker compose logs --tail=50 backend
exit 1
