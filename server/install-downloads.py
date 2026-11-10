#!/usr/bin/env python3
"""One-time install: python3 install-downloads.py /root/private-config.json.

Upload this directory's download-agent.mjs, download-update.py and three
website-download-* units alongside this installer. Config contains origin,
bridgeKey, username and password; it must use an AList read-only user whose
role is restricted to the dedicated shared mount, never the administrator account.
"""
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys

if os.geteuid() != 0:
    raise SystemExit('Run as root')
source = Path(__file__).resolve().parent
config = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
if not config.get('origin', '').startswith('https://') or not all(config.get(k) for k in ['bridgeKey', 'username', 'password', 'mountPath']) or config.get('mountPath') == '/':
    raise SystemExit('Invalid private configuration')
if config['username'].lower() in ['admin', 'guest']:
    raise SystemExit('A dedicated read-only AList user is required')
try:
    account = pwd.getpwnam('website-downloads')
except KeyError:
    subprocess.run(['useradd', '--system', '--no-create-home', '--shell', '/usr/sbin/nologin', 'website-downloads'], check=True)
    account = pwd.getpwnam('website-downloads')
folder = Path('/etc/website-downloads')
folder.mkdir(mode=0o750, exist_ok=True)
os.chown(folder, 0, account.pw_gid)
private = folder / 'config.json'
if private.exists():
    previous = json.loads(private.read_text())
    for key in ['importAuthFile', 'importStatePath']:
        if key not in config and key in previous:
            config[key] = previous[key]
private.write_text(json.dumps(config), encoding='utf-8')
private.chmod(0o640)
os.chown(private, 0, account.pw_gid)
base = Path('/opt/website-downloads')
base.mkdir(mode=0o755, exist_ok=True)
code = (source / 'download-agent.mjs').read_bytes()
digest = hashlib.sha256(code).hexdigest()
target = base / (digest + '.mjs')
target.write_bytes(code)
target.chmod(0o644)
subprocess.run(['runuser', '-u', 'website-downloads', '--', '/usr/bin/node', '--check', str(target)], check=True)
current = base / 'current.mjs'
next_link = base / 'next.mjs'
next_link.unlink(missing_ok=True)
next_link.symlink_to(target.name)
os.replace(next_link, current)
shutil.copyfile(source / 'download-update.py', base / 'download-update.py')
for name in ['website-download-agent.service', 'website-download-update.service', 'website-download-update.timer']:
    # Normalize line endings from Windows checkouts before systemd reads them.
    (Path('/etc/systemd/system') / name).write_text((source / name).read_text(), encoding='utf-8')
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', '--now', 'website-download-agent.service', 'website-download-update.timer'], check=True)
subprocess.run(['systemctl', 'restart', 'website-download-agent.service'], check=True)
print('Installed private metadata bridge and five-minute release update timer. No listening ports added.')
