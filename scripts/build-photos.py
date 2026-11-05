"""Generate public WebP photos from a configured source directory. Requires Pillow."""
import json
import os
from pathlib import Path
from PIL import Image, ImageOps

root = Path(__file__).resolve().parent.parent
config_path = root / 'config' / 'photos.local.json'
config = json.loads(config_path.read_text(encoding='utf-8')) if config_path.exists() else {}
source = Path(os.environ.get('PHOTO_SOURCE_DIR') or config.get('source') or 'assets-local/photos')
if not source.is_absolute():
    source = root / source
if not source.is_dir():
    raise SystemExit('Photo source directory not found. Set PHOTO_SOURCE_DIR or config/photos.local.json before building.')
dest = root / 'public' / 'photos' / 'images'
dest.mkdir(parents=True, exist_ok=True)
featured = ['学术知性风', '户外生活风', '电影氛围风', '商务精英风']
files = sorted((p for p in source.rglob('*') if p.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp'} and p.stem != '正面照'), key=lambda p: (featured.index(p.stem) if p.stem in featured else 99, p.name))
for suffix in ('thumb', 'large'):
    (dest / f'正面照-{suffix}.webp').unlink(missing_ok=True)
photos = []
for file in files:
    slug = file.relative_to(source).with_suffix('').as_posix().replace('/', '-')
    with Image.open(file) as original:
        image = ImageOps.exif_transpose(original).convert('RGB')
        width, height = image.size
        for suffix, size, quality in [('thumb', 640, 78), ('large', 1920, 88)]:
            preview = image.copy()
            preview.thumbnail((size, size))
            preview.save(dest / f'{slug}-{suffix}.webp', 'WEBP', quality=quality)
    photos.append({'title': file.stem, 'src': f'/photos/images/{slug}-large.webp', 'thumb': f'/photos/images/{slug}-thumb.webp', 'width': width, 'height': height, 'featured': file.stem in featured})
(root / 'public' / 'photos' / 'data.json').write_text(json.dumps(photos, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Built {len(photos)} photos; EXIF orientation applied, metadata omitted.')
