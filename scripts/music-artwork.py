"""Cache public video artwork for the published playlist, without login or search.

Run manually after exporting songs. Requires Pillow for square thumbnails.
Requests are sequential, spaced out, and stop on Bilibili risk control.
"""
import io
import json
import random
import time
import urllib.error
import urllib.request
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PLAYLIST = ROOT / 'public/music/playlist.json'
ART = ROOT / 'public/music/artwork'
HEADERS = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/'}


def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=20)


def main():
    data = json.loads(PLAYLIST.read_text(encoding='utf-8'))
    ART.mkdir(parents=True, exist_ok=True)
    tracks = [track for track in data['tracks'] if track.get('confirmed')]
    for track in tracks:
        target = ART / (track['id'] + '.webp')
        if target.exists() and track.get('cover') and track.get('seconds'):
            continue
        try:
            with request('https://api.bilibili.com/x/web-interface/view?bvid=' + track['bvid']) as response:
                result = json.load(response)
            if result.get('code') in [-412, -352]:
                print('Risk control: stopped without retrying.', flush=True)
                break
            if result.get('code') != 0:
                print('Unavailable:', track['id'], flush=True)
                continue
            video = result['data']
            page = video['pages'][int(track.get('page', 1)) - 1]
            with request(video['pic']) as response:
                image = Image.open(io.BytesIO(response.read())).convert('RGB')
            ImageOps.fit(image, (640, 640), method=Image.Resampling.LANCZOS).save(target, 'WEBP', quality=85)
            track['cover'] = '/music/artwork/' + target.name
            track['seconds'] = page['duration']
            print('Cached artwork:', track['id'], flush=True)
        except urllib.error.HTTPError as error:
            print('Artwork request:', error.code, track['id'], flush=True)
            if error.code in [412, 429]:
                break
        except (OSError, KeyError, IndexError, ValueError) as error:
            print('Artwork skipped:', track['id'], type(error).__name__, flush=True)
        time.sleep(random.uniform(2.2, 3.8))
    PLAYLIST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    images = [ART / (track['id'] + '.webp') for track in tracks if (ART / (track['id'] + '.webp')).exists()][:4]
    if len(images) == 4:
        collage = Image.new('RGB', (640, 640))
        for index, path in enumerate(images):
            with Image.open(path) as image:
                collage.paste(image.resize((320, 320), Image.Resampling.LANCZOS), ((index % 2) * 320, (index // 2) * 320))
        collage.save(ART / 'collection.webp', 'WEBP', quality=88)


if __name__ == '__main__':
    main()
