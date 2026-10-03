#!/usr/bin/env bash
# Hosts the dashboard front on the VPS (the data pipeline stays on GitHub
# Actions). Idempotent: re-run it to update the nginx config or repair.
#
#   ./scripts/deploy-vps.sh                 # deploy / update (default target)
#   ./scripts/deploy-vps.sh ubuntu@host     # other target
#
# Layout on the VPS (/opt/chog_dash):
#   repo/      sparse, shallow clone of the PUBLIC repo — only public/ is checked
#              out; cron pulls it every 5 min, so a CI rebuild shows up ≤5 min
#              after it lands on main
#   nginx.conf gzip + precompressed data.json (gzip_static), revalidation
#              headers so a new data.json is picked up without a hard refresh
#   docker-compose.yml  nginx:alpine bound to 127.0.0.1:3500 only — same rule
#              as every service on this box: ONLY SSH is open (ufw). Reach it
#              through a tunnel:  ssh -L 3500:localhost:3500 ubuntu@51.255.39.134
#              then http://localhost:3500
set -euo pipefail
CIBLE="${1:-ubuntu@51.255.39.134}"
DIST=/opt/chog_dash
REPO_URL=https://github.com/0xDeRauX/chog_dash.git

ssh -o ConnectTimeout=15 "$CIBLE" "DIST=$DIST REPO_URL=$REPO_URL bash -s" <<'DIST_SCRIPT'
set -euo pipefail
sudo mkdir -p "$DIST" && sudo chown -R "$USER:$USER" "$DIST"
cd "$DIST"

if [ ! -d repo/.git ]; then
  git clone -q --depth 1 --filter=blob:none --sparse "$REPO_URL" repo
  git -C repo sparse-checkout set public
fi

cat > sync.sh <<'EOF'
#!/bin/sh
# Pull the latest build of the front (public/) and precompress data.json.
set -e
cd "$(dirname "$0")/repo"
git fetch -q --depth 1 origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ]; then
  git reset -q --hard FETCH_HEAD
fi
if [ ! -f public/data.json.gz ] || [ public/data.json -nt public/data.json.gz ]; then
  gzip -9 -k -f public/data.json
fi
EOF
chmod +x sync.sh
./sync.sh

cat > nginx.conf <<'EOF'
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  gzip on;
  gzip_comp_level 5;
  gzip_min_length 1024;
  gzip_types application/json application/javascript text/javascript text/css image/svg+xml;
  gzip_static on;   # serves data.json.gz built by sync.sh (8 MB → ~1.7 MB, compressed once)

  # data + code change daily: always revalidate (cheap 304 via ETag)
  location ~* \.(json|js|css|html)$ {
    add_header Cache-Control "no-cache";
    try_files $uri =404;
  }
  # clean URLs like /studio → studio.html (same rewrites as serve.json)
  location / {
    try_files $uri $uri.html $uri/ =404;
  }
}
EOF

cat > docker-compose.yml <<'EOF'
services:
  front:
    image: nginx:alpine
    container_name: chog-dash-front
    restart: unless-stopped
    ports:
      - "127.0.0.1:3500:80"
    volumes:
      - ./repo/public:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
EOF
docker compose up -d --force-recreate >/dev/null 2>&1 || docker compose up -d --force-recreate

# cron: pull every 5 min (keep any other entries)
LINE="*/5 * * * * $DIST/sync.sh >> /tmp/chog-dash-sync.log 2>&1"
( crontab -l 2>/dev/null | grep -v "$DIST/sync.sh" ; echo "$LINE" ) | crontab -

sleep 2
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3500/)
gz=$(curl -s -H "Accept-Encoding: gzip" -o /dev/null -w "%{size_download}" http://127.0.0.1:3500/data.json)
echo "front HTTP $code · data.json transféré compressé : $((gz / 1024)) Ko"
DIST_SCRIPT

echo "OK — tunnel : ssh -L 3500:localhost:3500 $CIBLE  puis http://localhost:3500"
