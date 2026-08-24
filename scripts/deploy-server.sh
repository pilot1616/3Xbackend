#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Edit .env, then rerun this script."
  exit 1
fi

if [ -f images.tar ]; then
  echo "Loading Docker images..."
  docker load -i images.tar
fi

mkdir -p public/images public/uploads

echo "Starting services..."
docker compose --env-file .env -f docker-compose.yml up -d

echo "Current service status:"
docker compose --env-file .env -f docker-compose.yml ps
