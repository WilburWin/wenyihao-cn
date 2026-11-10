#!/usr/bin/env python3
"""Root-only one-time provisioning from an existing private AList mount.

No credentials are printed. The agent receives OAuth credentials for imports;
the AList reader account remains read-only. Public requests cannot select a
destination: all writes stay under the configured mount's 链接导入 directory.
"""
import grp
import json
import os
from pathlib import Path
import time
import urllib.request

if os.geteuid() != 0:
    raise SystemExit('Run as root')
admin = json.loads(Path('/etc/website-alist-admin.json').read_text())


def api(path, body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = token
    req = urllib.request.Request('http://127.0.0.1:5244' + path,
        data=json.dumps(body).encode() if body is not None else None, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as response:
        result = json.load(response)
    if result['code'] != 200:
        raise RuntimeError('Private AList configuration request failed')
    return result['data']


token = api('/api/auth/login', {'username': admin['username'], 'password': admin['password']})['token']
config_path = Path('/etc/website-downloads/config.json')
config = json.loads(config_path.read_text())
storage = next(s for s in api('/api/admin/storage/list?page=1&per_page=100', token=token)['content']
               if s['driver'] == 'BaiduNetdisk' and s['mount_path'] == config['mountPath'])
addition = json.loads(storage['addition'])
root = addition['root_folder_path'].rstrip('/')
if root != '/网站分享':
    raise SystemExit('Expected the dedicated /网站分享 storage root')
auth = {'root': root + '/链接导入', 'accessToken': addition.get('AccessToken', ''),
        'expiresAt': int(time.time() * 1000) + 86400000,
        'refreshToken': addition['refresh_token'], 'clientId': addition['client_id'],
        'clientSecret': addition['client_secret']}
if not all(auth[k] for k in ['refreshToken', 'clientId', 'clientSecret']):
    raise SystemExit('Incomplete OAuth configuration')
target = Path('/etc/website-downloads/baidu-import.json')
target.write_text(json.dumps(auth), encoding='utf-8')
target.chmod(0o640)
os.chown(target, 0, grp.getgrnam('website-downloads').gr_gid)
config['importAuthFile'] = str(target)
config['importStatePath'] = '/var/lib/website-downloads'
config_path.write_text(json.dumps(config), encoding='utf-8')
config_path.chmod(0o640)
print('Configured share imports limited to the dedicated import directory. No credentials printed.')
