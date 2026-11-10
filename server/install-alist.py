#!/usr/bin/env python3
"""Install a pinned, checksum-verified AList release for loopback-only setup.

Fresh installations only: refuses existing data/services, never resets credentials.
Run as root with the official release archive and adjacent service unit.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import subprocess
import tarfile
import time
import urllib.request

VERSION = '3.66.0'
SHA256 = '06a2ab394c1bce4d29b84021192aa75350f556bd1a1e98d321ad760170b5ed31'
USER = 'website-alist'
BASE = Path('/opt/website-alist')
DATA = Path('/var/lib/website-alist')
ADMIN = Path('/etc/website-alist-admin.json')
UNIT = Path('/etc/systemd/system/website-alist.service')


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=90, **kwargs)


def private_json(path, value, uid=0, gid=0):
    # O_EXCL protects against overwriting an existing installation or credential.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        os.fchown(out.fileno(), uid, gid)
        json.dump(value, out, indent=2)
        out.flush()
        os.fsync(out.fileno())


def secure_initial_accounts(password):
    base = 'http://127.0.0.1:5244'
    for attempt in range(20):
        try:
            with urllib.request.urlopen(base + '/ping', timeout=2) as response:
                if response.read(16) == b'pong':
                    break
        except OSError:
            pass
        time.sleep(.5)
    else:
        raise RuntimeError('AList did not become ready.')

    def api(path, body=None, token=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = token
        request = urllib.request.Request(base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers, method='POST' if body is not None else 'GET')
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.load(response)
        if data.get('code') != 200:
            raise RuntimeError('AList setup API rejected an operation; response omitted.')
        return data['data']

    login = api('/api/auth/login', {'username': 'admin', 'password': password})
    token = login['token']
    users = api('/api/admin/user/list?page=1&per_page=100', token=token)
    for user in users.get('content', []):
        if user.get('username') == 'guest' and not user.get('disabled'):
            user['disabled'] = True
            api('/api/admin/user/update', user, token)
    users = api('/api/admin/user/list?page=1&per_page=100', token=token)
    if any(not user.get('disabled') for user in users.get('content', []) if user.get('username') == 'guest'):
        raise RuntimeError('Guest account disable verification failed.')
    return token


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run as root.')
    if any(p.exists() for p in [BASE, DATA, ADMIN, UNIT]):
        raise SystemExit('Existing AList installation detected; refusing to overwrite data or credentials.')
    unit_source = Path(__file__).with_name('website-alist.service')
    if not unit_source.is_file():
        raise SystemExit('Adjacent website-alist.service is required.')
    hasher = hashlib.sha256()
    with args.archive.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            hasher.update(chunk)
    digest = hasher.hexdigest()
    if digest != SHA256:
        raise SystemExit('Official release SHA-256 mismatch; archive will not be executed.')
    print('Official release archive SHA-256 verified.')
    release = BASE / 'releases' / VERSION
    release.mkdir(parents=True, mode=0o755)
    with tarfile.open(args.archive, 'r:gz') as archive:
        binary = next((m for m in archive.getmembers() if m.name in ('alist', './alist') and m.isfile()), None)
        if not binary or binary.size > 250_000_000:
            raise SystemExit('Expected a regular AList binary within size limit.')
        # Do not extract arbitrary archive paths, links or permissions as root.
        with archive.extractfile(binary) as source, (release / 'alist').open('xb') as target:
            shutil.copyfileobj(source, target)
    os.chmod(release / 'alist', 0o755)
    BASE.joinpath('current').symlink_to(release, target_is_directory=True)
    try:
        user = pwd.getpwnam(USER)
    except KeyError:
        run(['useradd', '--system', '--home-dir', str(DATA), '--shell', '/usr/sbin/nologin', USER])
        user = pwd.getpwnam(USER)
    DATA.mkdir(mode=0o700)
    os.chown(DATA, user.pw_uid, user.pw_gid)
    configuration = {
        'site_url': '', 'cdn': '', 'jwt_secret': secrets.token_urlsafe(48), 'token_expires_in': 2,
        'database': {'type': 'sqlite3', 'db_file': str(DATA / 'data.db'), 'table_prefix': 'x_'},
        'scheme': {'address': '127.0.0.1', 'http_port': 5244, 'https_port': -1,
                   'force_https': False, 'unix_file': '', 'enable_h2c': False},
        'temp_dir': str(DATA / 'temp'), 'bleve_dir': str(DATA / 'bleve'),
        'log': {'enable': False}, 'max_connections': 24, 'max_concurrency': 4,
        'tls_insecure_skip_verify': False,
        'cors': {'allow_origins': ['http://127.0.0.1:15244', 'http://localhost:15244', 'http://127.0.0.1:5244'],
                 'allow_methods': ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
                 'allow_headers': ['Authorization', 'Content-Type']},
        's3': {'enable': False, 'port': -1}, 'ftp': {'enable': False, 'listen': ''},
        'sftp': {'enable': False, 'listen': ''}, 'mcp': {'enable': False, 'port': -1},
        'tasks': {kind: {'workers': 1, 'max_retry': 0, 'task_persistant': False}
                  for kind in ['download', 'transfer', 'upload', 'copy', 'decompress', 'decompress_upload', 's3_transition']},
    }
    private_json(DATA / 'config.json', configuration, user.pw_uid, user.pw_gid)
    password = secrets.token_urlsafe(27)
    private_json(ADMIN, {'url': 'http://127.0.0.1:15244', 'username': 'admin', 'password': password})
    # Bootstrap before the daemon starts; suppress initial/admin-password output.
    # File logging is disabled, so generated credentials never enter journal/file logs.
    try:
        run(['runuser', '-u', USER, '--', str(BASE / 'current' / 'alist'),
             'admin', 'set', password, '--data', str(DATA), '--log-std'])
    except subprocess.SubprocessError:
        raise SystemExit('Admin bootstrap failed; credentials and captured output omitted. Inspect the installation privately.')
    shutil.copyfile(unit_source, UNIT)
    os.chmod(UNIT, 0o644)
    run(['systemd-analyze', 'verify', str(UNIT)])
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'website-alist'])
    try:
        secure_initial_accounts(password)
    except Exception:
        run(['systemctl', 'stop', 'website-alist'])
        raise SystemExit('Initial login/guest verification failed; service stopped, credentials and response omitted.')
    print('AList ' + VERSION + ' installed; loopback 127.0.0.1:5244; administrator credential is root-only.')


if __name__ == '__main__':
    main()
