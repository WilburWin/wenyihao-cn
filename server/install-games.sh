#!/usr/bin/env bash
# Run as root with a release archive made from the tracked source files.
set -euo pipefail
archive=${1:?Usage: bash install-games.sh /absolute/path/release.tar.gz}
release_id=${2:-$(date -u +%Y%m%dT%H%M%SZ)}
[[ "$release_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo 'Invalid release ID'; exit 1; }
[[ $EUID -eq 0 ]] || { echo 'Run as root'; exit 1; }
base=/opt/website-games
release="$base/releases/$release_id"
previous=$(readlink -f "$base/current" || true)
[[ ! -e "$release" ]] || { echo 'Release already exists'; exit 1; }
id website-games >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/website-games --shell /usr/sbin/nologin website-games
install -d -m 755 "$release"
tar -xzf "$archive" -C "$release"
cd "$release"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node --test test/game-server.test.js
install -m 644 server/website-games.service /etc/systemd/system/website-games.service
if [[ ! -e /etc/website-games.env ]]; then
  printf '%s\n' 'GAME_ORIGINS=http://localhost:8787,http://127.0.0.1:8787' > /etc/website-games.env
  chmod 600 /etc/website-games.env
fi
ln -s "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
systemctl daemon-reload
systemctl enable website-games.service
systemctl restart website-games.service
for attempt in 1 2 3 4 5; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8788/healthz; then
    printf '\nRelease installed: %s\n' "$release_id"
    exit 0
  fi
  sleep 1
done
echo 'Health check failed; reverting to the previous release.' >&2
if [[ -n "$previous" && -d "$previous" ]]; then
  ln -s "$previous" "$base/current.rollback"
  mv -Tf "$base/current.rollback" "$base/current"
  systemctl restart website-games.service
else
  systemctl stop website-games.service
fi
exit 1
