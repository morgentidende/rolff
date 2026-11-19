#!/usr/bin/env python3
"""Regenerate the Rolff app icons from the one speech-bubble glyph.

Needs Pillow, numpy and a headless Chrome/Chromium (CHROME env var or `google-chrome`).
Run from the repo root:  python3 scripts/build-icons.py
The white notification badges (icons/rolff-badge-*.png) are NOT touched.
"""
import io, os, subprocess, sys, tempfile, shutil
from PIL import Image
import numpy as np

PUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'apps', 'web', 'public')
CHROME = os.environ.get('CHROME') or shutil.which('google-chrome') or shutil.which('chromium')

# Glyph geometry in the original 640-unit space (bubble incl. tail: x 134..505, y 140..~500).
BUBBLE = "M289 140H350A155 155 0 0 1 350 450H278C262 450 250 456 236 463C206 479 180 493 158 498C146 501 136 494 141 484C153 462 165 440 165 412C165 400 160 390 154 380C142 356 134 328 134 295A155 155 0 0 1 289 140Z"
R_STEM = '<rect x="245" y="212" width="74" height="182" rx="34" fill="#000"/>'
R_ARM = '<path fill="#000" d="M300 240C322 220 344 211 368 211H373C396 211 410 226 410 248C410 266 400 280 380 280H352C332 280 319 295 319 318V330H290V250Z"/>'
MASK = f'<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="640"><rect width="640" height="640" fill="#000"/><path fill="#fff" d="{BUBBLE}"/>{R_STEM}{R_ARM}</mask>'
GRAD = '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B8189"/><stop offset=".55" stop-color="#016C72"/><stop offset="1" stop-color="#015459"/></linearGradient>'
BBOX = (134.0, 140.0, 505.0, 500.0)   # measured bubble bounds in glyph space (tail included)

# Bubble width as a share of the whole icon.  Before: ~54 % (png) / 66 % (svg).
ANY_FRAC = 0.76        # any / apple-touch / favicon
MASKABLE_FRAC = 0.648  # limited by the 80 %-diameter safe circle (checked below)

# Glyph point that sits at the exact middle of the canvas.  'any'/apple: middle of the bubble's
# bounding box.  Maskable: nudged 75 % of the way towards the centre of the smallest circle that
# holds the whole bubble (tail included), so the tail does not poke out of the safe zone.
CENTER_ANY = ((BBOX[0] + BBOX[2]) / 2, (BBOX[1] + BBOX[3]) / 2)
CENTER_MASKABLE = (306.37, 336.09)

def glyph_tf(frac, size=1024, center=CENTER_ANY):
    k = frac * size / (BBOX[2] - BBOX[0])
    return k, size / 2 - center[0] * k, size / 2 - center[1] * k

def svg(kind, frac, size=1024, center=CENTER_ANY):
    k, tx, ty = glyph_tf(frac, size, center)
    shadow = f'<g transform="translate({tx:.2f} {ty + 6.15 * k / 1.82167:.2f}) scale({k:.5f})" opacity=".18"><rect width="640" height="640" fill="#00262a" mask="url(#m)"/></g>'
    white = f'<g transform="translate({tx:.2f} {ty:.2f}) scale({k:.5f})"><rect width="640" height="640" fill="#fff" mask="url(#m)"/></g>'
    if kind == 'mono':
        bg, shadow = '', ''
    else:
        rx = ' rx="230"' if kind == 'any' else ''
        bg = f'<rect width="{size}" height="{size}"{rx} fill="url(#g)"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}" role="img" aria-label="Rolff">'
            f'<defs>{GRAD}{MASK}</defs>{bg}{shadow}{white}</svg>')

def render(svg_text, size=1024):
    d = tempfile.mkdtemp()
    p = os.path.join(d, 'i.svg'); o = os.path.join(d, 'o.png')
    open(p, 'w').write(svg_text)
    subprocess.run([CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
                    f'--window-size={size},{size}', f'--screenshot={o}', 'file://' + p], check=True, capture_output=True)
    im = Image.open(o).convert('RGBA'); shutil.rmtree(d)
    return im.crop((0, 0, size, size))

def white_mask(im):
    a = np.array(im).astype(int)
    return (a[..., 0] > 235) & (a[..., 1] > 235) & (a[..., 2] > 235) & (a[..., 3] > 200)

def safe_radius(im):
    ys, xs = np.where(white_mask(im)); n = im.size[0]
    return np.sqrt((xs - n / 2) ** 2 + (ys - n / 2) ** 2).max() / n   # must be <= 0.40

def save(im, path, size, opaque=False):
    out = im.resize((size, size), Image.LANCZOS)
    if opaque: out = out.convert('RGB')
    out.save(path, optimize=True)

def main():
    any_ = render(svg('any', ANY_FRAC)); full = render(svg('full', ANY_FRAC))
    mask = render(svg('full', MASKABLE_FRAC, center=CENTER_MASKABLE)); mono = render(svg('mono', MASKABLE_FRAC, center=CENTER_MASKABLE))
    r = safe_radius(mask); print('maskable farthest white pixel from centre: %.3f of icon width (limit 0.400)' % r)
    assert r <= 0.40, 'glyph leaves the maskable safe zone'
    for s in (16, 32, 64, 128, 192, 512): save(any_, f'{PUB}/icons/rolff-{s}.png', s)
    for s in (192, 512): save(mask, f'{PUB}/icons/rolff-maskable-{s}.png', s, opaque=True)
    save(full, f'{PUB}/apple-touch-icon.png', 180, opaque=True)
    save(mono, f'{PUB}/icons/rolff-monochrome-512.png', 512)
    any_.resize((48, 48), Image.LANCZOS).save(f'{PUB}/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
    open(f'{PUB}/favicon.svg', 'w').write(svg('any', ANY_FRAC) + '\n')

if __name__ == '__main__':
    main()
