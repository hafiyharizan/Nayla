#!/usr/bin/env python3
"""Encode with js/qr.js, decode with a real scanner, assert the text survives."""
import json, subprocess, sys, os, random, string
from PIL import Image
import zxingcpp

QR_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js', 'qr.js')

def encode(text):
    js = (f"const QR=require({json.dumps(QR_JS)});"
          f"const r=QR.matrix({json.dumps(text)});"
          "process.stdout.write(JSON.stringify({v:r.version,mask:r.mask,"
          "m:r.modules.map(x=>x.map(y=>y?1:0))}))")
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr[:400])
    return json.loads(out.stdout)

def render(modules, scale=6, quiet=4):
    n = len(modules)
    total = (n + quiet * 2) * scale
    img = Image.new('L', (total, total), 255)
    px = img.load()
    for r in range(n):
        for c in range(n):
            if modules[r][c]:
                for dy in range(scale):
                    for dx in range(scale):
                        px[(c + quiet) * scale + dx, (r + quiet) * scale + dy] = 0
    return img

random.seed(11)
alphabet = string.ascii_letters + string.digits + ':/.#-_?=&'
cases = []

# Every version boundary, and either side of it — padding bugs hide here.
for cap in (17, 32, 53, 78, 106, 134, 154, 192, 230, 271):
    for length in (cap - 1, cap):
        cases.append(''.join(random.choice(alphabet) for _ in range(length)))
# A sweep through the middle of the range, where pad codewords exist.
for length in range(1, 272, 7):
    cases.append(''.join(random.choice(alphabet) for _ in range(length)))
# The shapes this app actually produces.
cases.append('https://hafiyharizan.github.io/Nayla/#pair=' + 'd1f08131c14299661e2b490109dc780e')
cases.append('https://hafiyharizan.github.io/Nayla/#pair=' + '0' * 32)
cases.append('https://hafiyharizan.github.io/Nayla/#pair=' + 'f' * 32)

failures = []
versions = set()
for text in cases:
    got = encode(text)
    versions.add(got['v'])
    res = zxingcpp.read_barcodes(render(got['m']))
    if not res:
        failures.append((len(text), got['v'], got['mask'], 'not detected'))
    elif res[0].text != text:
        failures.append((len(text), got['v'], got['mask'], 'wrong text'))

print(f"QR round-trip: {len(cases) - len(failures)}/{len(cases)} decoded exactly "
      f"(versions {min(versions)}-{max(versions)})")
for length, v, mask, why in failures:
    print(f"  FAIL len={length} v{v} mask{mask}: {why}")
sys.exit(1 if failures else 0)
