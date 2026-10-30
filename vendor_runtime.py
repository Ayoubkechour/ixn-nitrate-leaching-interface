"""Download the pinned browser runtime and verify package-wheel hashes.

All runtime files are served with the site, so calculations do not depend on
third-party network requests at run time. Re-run only to restore missing assets.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import subprocess

VERSION='0.29.3'
BASE=f'https://cdn.jsdelivr.net/pyodide/v{VERSION}/full/'
DEST=Path(__file__).resolve().parent/'dist'/'vendor'/'pyodide'
DEST.mkdir(parents=True,exist_ok=True)

def download(name, expected=None):
    target=DEST/name
    if not target.exists():
        subprocess.run(['curl','--retry','3','-fsSL',BASE+name,'-o',str(target)],check=True)
    if expected and hashlib.sha256(target.read_bytes()).hexdigest()!=expected:
        raise ValueError('Runtime package integrity mismatch: '+name)
    print(name,target.stat().st_size,flush=True)

download('pyodide-lock.json')
packages=json.loads((DEST/'pyodide-lock.json').read_text())['packages']
selected=set()
def visit(name):
    if name in selected:return
    selected.add(name)
    for dep in packages[name].get('depends',[]):visit(dep)
for name in ['numpy','pandas','matplotlib']:visit(name)
items=[(name,None) for name in ['pyodide.js','pyodide.mjs','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip']]
items += [(packages[name]['file_name'],packages[name]['sha256']) for name in selected]
with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(lambda item:download(*item),items))
(DEST/'SOURCE.txt').write_text(f'Pyodide {VERSION}\nSource: {BASE}\nhttps://github.com/pyodide/pyodide\nMozilla Public License 2.0; individual package licenses are included in their wheels.\n')
print('Pinned runtime downloaded and wheel hashes verified.')
