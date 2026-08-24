#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RELEASE_NAME=${RELEASE_NAME:-3xbackend-release}
IMAGE_TAG=${IMAGE_TAG:-latest}
DIST_DIR="$ROOT_DIR/dist"
WORK_DIR="$DIST_DIR/$RELEASE_NAME"
ARCHIVE="$DIST_DIR/$RELEASE_NAME.tar.gz"

APP_IMAGE=${APP_IMAGE:-3xbackend-app:$IMAGE_TAG}
AGENT_IMAGE=${AGENT_IMAGE:-3xbackend-agent:$IMAGE_TAG}
DATA_FETCH_IMAGE=${DATA_FETCH_IMAGE:-3xbackend-data-fetch:$IMAGE_TAG}
MYSQL_IMAGE=${MYSQL_IMAGE:-mysql:8.4}

mkdir -p "$DIST_DIR"
rm -rf "$WORK_DIR" "$ARCHIVE"
mkdir -p "$WORK_DIR/scripts" "$WORK_DIR/public/images" "$WORK_DIR/public/uploads"

echo "Building images..."
docker build -t "$APP_IMAGE" -f "$ROOT_DIR/Dockerfile" "$ROOT_DIR"
docker build -t "$AGENT_IMAGE" -f "$ROOT_DIR/agent/Dockerfile" "$ROOT_DIR/agent"
docker build -t "$DATA_FETCH_IMAGE" -f "$ROOT_DIR/data-fetch/Dockerfile" "$ROOT_DIR/data-fetch"
docker pull "$MYSQL_IMAGE"

echo "Saving images..."
docker save -o "$WORK_DIR/images.tar" "$APP_IMAGE" "$AGENT_IMAGE" "$DATA_FETCH_IMAGE" "$MYSQL_IMAGE"

cp "$ROOT_DIR/docker-compose.prod.yml" "$WORK_DIR/docker-compose.yml"
cp "$ROOT_DIR/.env.production.example" "$WORK_DIR/.env.example"
cp "$ROOT_DIR/scripts/deploy-server.sh" "$WORK_DIR/scripts/deploy-server.sh"
chmod +x "$WORK_DIR/scripts/deploy-server.sh"

cat > "$WORK_DIR/README.deploy.txt" <<'EOF'
1. Copy .env.example to .env and edit passwords, AUTH_SECRET, admin usernames, and LLM settings.
2. Run: ./scripts/deploy-server.sh
3. Check: docker compose ps
4. Optional first data init: open /admin/sync as an admin user and run full history sync.
EOF

(cd "$DIST_DIR" && tar -czf "$ARCHIVE" "$RELEASE_NAME")

echo "Release package created:"
echo "$ARCHIVE"
