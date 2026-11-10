#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root'; exit 1; }
source_dir=${1:?Usage: bash install-monitor.sh /absolute/path/to/server}
install -d -m 755 /opt/website-monitor
if [[ $(readlink -f "$source_dir/monitor.py") != /opt/website-monitor/monitor.py ]]; then
  install -m 644 "$source_dir/monitor.py" /opt/website-monitor/monitor.py
fi
install -m 644 "$source_dir/website-monitor.service" /etc/systemd/system/website-monitor.service
install -m 644 "$source_dir/website-monitor.timer" /etc/systemd/system/website-monitor.timer
[[ -f /etc/website-monitor.env ]] || { echo 'Create the root-only environment file first'; exit 1; }
chmod 600 /etc/website-monitor.env
python3 /opt/website-monitor/monitor.py --check-guard
systemctl daemon-reload
systemctl start website-monitor.service
systemctl enable --now website-monitor.timer
systemctl status website-monitor.timer --no-pager
