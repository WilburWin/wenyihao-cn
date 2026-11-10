#!/usr/bin/env python3
"""Install metadata-agent releases from the authenticated site deployment.

Run as root from systemd. Source only runs as website-downloads, never as root.
The first local installation uses the same content hash and service contract.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request

BASE = Path('/opt/website-downloads')
CONFIG = Path('/etc/website-downloads/config.json')


def update():
    config = json.loads(CONFIG.read_text())
    req = urllib.request.Request(config['origin'] + '/api/tools/agent-release', headers={
        'Authorization': 'Bearer ' + config['bridgeKey'],
        'User-Agent': 'WebsiteDownloadUpdater/1.0', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        data = response.read(131073)
    if len(data) > 131072:
        raise ValueError('Release too large')
    release = json.loads(data)
    source = release['source'].encode('utf-8')
    digest = hashlib.sha256(source).hexdigest()
    if digest != release['sha256']:
        raise ValueError('Release checksum mismatch')
    current = BASE / 'current.mjs'
    target = BASE / (digest + '.mjs')
    if current.exists() and current.resolve() == target:
        return
    if not target.exists():
        target.write_bytes(source)
        target.chmod(0o644)
    subprocess.run(['runuser', '-u', 'website-downloads', '--', '/usr/bin/node', '--check', str(target)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    old = current.resolve() if current.exists() else None
    link = BASE / 'next.mjs'
    link.unlink(missing_ok=True)
    link.symlink_to(target.name)
    os.replace(link, current)
    subprocess.run(['systemctl', 'restart', 'website-download-agent'], check=True)
    import time
    time.sleep(4)
    if subprocess.run(['systemctl', 'is-active', '--quiet', 'website-download-agent']).returncode:
        if old:
            link.symlink_to(old.name)
            os.replace(link, current)
            subprocess.run(['systemctl', 'restart', 'website-download-agent'], check=False)
        raise RuntimeError('Agent startup failed; previous release restored')
    print('Download metadata agent updated: ' + digest[:12])


if __name__ == '__main__':
    try:
        update()
    except Exception:
        # Never log upstream responses or signed URLs/credentials.
        print('Download agent update failed; current installed release retained.')
        raise SystemExit(1)
