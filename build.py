#!/usr/bin/env python3
"""Build the downloadable zip and the download page.

    python3 build.py           build docs/downloads/<zip>, SHA256SUMS and docs/index.html
    python3 build.py --check   verify the published hash matches the zip in docs/downloads

The zip is deterministic (sorted entries, fixed timestamps, stored not compressed),
so anyone can rebuild it from the source and get the same SHA-256.
"""
import hashlib, pathlib, re, sys, zipfile, datetime

ROOT = pathlib.Path(__file__).resolve().parent
VERSION = (ROOT / 'VERSION').read_text().strip()
NAME = f'paycheck-planner-{VERSION}'
OUT = ROOT / 'docs' / 'downloads'
APP_FILES = {  # path in zip -> source file
    'index.html': ROOT / 'index.html',
    'app.js': ROOT / 'app.js',
    'style.css': ROOT / 'style.css',
    'USAGE.txt': ROOT / 'package' / 'USAGE.txt',
    'VERSION': ROOT / 'VERSION',
}


def sha256(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def build_zip(path=None):
    if f"const VERSION = '{VERSION}'" not in (ROOT / 'app.js').read_text():
        sys.exit(f"app.js VERSION does not match VERSION file ({VERSION}); update one of them.")
    OUT.mkdir(parents=True, exist_ok=True)
    path = path or OUT / f'{NAME}.zip'
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_STORED) as z:
        for arc in sorted(APP_FILES):
            zi = zipfile.ZipInfo(f'{NAME}/{arc}', date_time=(2020, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_STORED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, APP_FILES[arc].read_bytes())
    return path


def write_sums():
    zips = sorted(OUT.glob('paycheck-planner-*.zip'))
    (OUT / 'SHA256SUMS').write_text(''.join(f'{sha256(p)}  {p.name}\n' for p in zips))


def build_page(zpath):
    tpl = (ROOT / 'site' / 'index.template.html').read_text()
    values = {
        'VERSION': VERSION, 'ZIP': zpath.name, 'SHA256': sha256(zpath),
        'SIZE_KB': f'{zpath.stat().st_size / 1024:.0f}', 'DATE': datetime.date.today().isoformat(),
    }
    for k, v in values.items():
        tpl = tpl.replace('{{' + k + '}}', v)
    assert '{{' not in tpl, 'unfilled placeholder in template'
    (ROOT / 'docs' / 'index.html').write_text(tpl)


def check():
    zpath = OUT / f'{NAME}.zip'
    if not zpath.exists():
        sys.exit(f'missing {zpath}')
    h = sha256(zpath)
    page = (ROOT / 'docs' / 'index.html').read_text()
    sums = (OUT / 'SHA256SUMS').read_text()
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        rebuilt = sha256(build_zip(pathlib.Path(d) / zpath.name))
    ok = (h in page) and (f'{h}  {zpath.name}' in sums) and rebuilt == h
    print(f'zip      {h}\npage     {"ok" if h in page else "MISMATCH"}\nSHA256SUMS {"ok" if f"{h}  {zpath.name}" in sums else "MISMATCH"}\nrebuild  {"identical" if rebuilt == h else "DIFFERENT (sources changed since the zip was built)"}')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    if '--check' in sys.argv:
        check()
    z = build_zip()
    write_sums()
    build_page(z)
    print(f'{z.relative_to(ROOT)}  {sha256(z)}')
