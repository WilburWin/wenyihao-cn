"""Optionally fill missing published track durations. Covers are loaded online.

Uses Python's standard library, no image downloads and no account credentials.
Requests are sequential and stop on Bilibili risk control.
"""
import json
import random
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAYLIST = ROOT / 'public/music/playlist.json'
HEADERS = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/'}


def main():
    data = json.loads(PLAYLIST.read_text(encoding='utf-8'))
    pending = [track for track in data['tracks'] if track.get('confirmed') and not track.get('seconds')]
    updated = 0
    try:
        for index, track in enumerate(pending):
            if index:
                time.sleep(random.uniform(2.2, 3.8))
            try:
                url = 'https://api.bilibili.com/x/web-interface/view?bvid=' + track['bvid']
                with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=20) as response:
                    result = json.load(response)
                if result.get('code') in [-412, -352]:
                    print('Risk control: stopped without retrying.', flush=True)
                    break
                if result.get('code') != 0:
                    print('Unavailable:', track['id'], flush=True)
                    continue
                track['seconds'] = result['data']['pages'][int(track.get('page', 1)) - 1]['duration']
                updated += 1
                print('Updated duration:', track['id'], flush=True)
            except urllib.error.HTTPError as error:
                print('Metadata request:', error.code, track['id'], flush=True)
                if error.code in [412, 429]:
                    break
            except (OSError, KeyError, IndexError, ValueError) as error:
                print('Metadata skipped:', track['id'], type(error).__name__, flush=True)
    finally:
        if updated:
            PLAYLIST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Updated durations:', updated)


if __name__ == '__main__':
    main()
