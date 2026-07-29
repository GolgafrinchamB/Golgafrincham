#!/usr/bin/env python3
"""Rebuild index.html from data/ + src/. Pure stdlib — no dependencies."""
import base64, csv, gzip, os, re, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, *p)

def read_tle(path):
    """Return dict norad -> (name, l1, l2, epoch_float)."""
    out = {}
    if not os.path.exists(path): return out
    lines = [l.rstrip('\r\n') for l in open(path, encoding='utf-8', errors='replace')]
    name = None
    for i, l in enumerate(lines):
        if l.startswith('1 ') and i + 1 < len(lines) and lines[i+1].startswith('2 '):
            try:
                norad = int(l[2:7])
                yy = int(l[18:20]); days = float(l[20:32])
                epoch = (2000 + yy if yy < 57 else 1900 + yy) * 1000 + days
            except ValueError:
                continue
            nm = name.strip() if name else 'NORAD %05d' % norad
            if nm.startswith('0 '): nm = nm[2:]
            prev = out.get(norad)
            if prev is None or epoch > prev[3]:
                out[norad] = (nm, l, lines[i+1], epoch)
            name = None
        elif not l.startswith('2 '):
            name = l
    return out

def main():
    cat = read_tle(D('data', 'active.tle'))
    if len(cat) < 8000:
        sys.exit('FATAL: active catalog implausibly small (%d) — refusing to build' % len(cat))
    # overlay group files if any carry newer epochs
    groups = {}
    gdir = D('data', 'groups')
    for f in sorted(os.listdir(gdir)) if os.path.isdir(gdir) else []:
        if not f.endswith('.tle'): continue
        g = read_tle(os.path.join(gdir, f))
        groups[f[:-4]] = set(g)
        for n, rec in g.items():
            if n in cat and rec[3] > cat[n][3]:
                cat[n] = rec
    ids = sorted(cat)
    tle_text = '\n'.join('%s\n%s\n%s' % cat[n][:3] for n in ids) + '\n'
    tle_b64 = base64.b64encode(gzip.compress(tle_text.encode(), 9)).decode()

    active = set(ids)
    tagmap = {'sta': 'stations', 'gps': 'gps-ops', 'glo': 'glo-ops', 'gal': 'galileo',
              'bei': 'beidou', 'wea': 'weather', 'sci': 'science', 'eo': 'resource', 'mil': 'military'}
    tags = {k: sorted(groups.get(v, set()) & active) for k, v in tagmap.items()}
    tags_js = 'const TAGS={' + ','.join('%s:[%s]' % (k, ','.join(map(str, v))) for k, v in tags.items()) + '};'
    data_date = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
    payload = 'const TLE_B64="%s";\n%s\nconst DATA_DATE="%s";\n' % (tle_b64, tags_js, data_date)

    # metadata: SATCAT + UCS
    sc = []
    for r in csv.DictReader(open(D('data', 'satcat.csv'), encoding='utf-8', errors='replace')):
        nid = r.get('NORAD_CAT_ID', '')
        if not nid or int(nid) not in active: continue
        rcs = r.get('RCS', '').strip()
        if rcs:
            try: rcs = '%g' % float(rcs)
            except ValueError: rcs = ''
        sc.append('%d|%s|%s|%s|%s|%s' % (int(nid), r.get('OWNER',''), r.get('LAUNCH_DATE',''),
                                         r.get('LAUNCH_SITE',''), r.get('OPS_STATUS_CODE',''), rcs))
    if len(sc) < len(active) // 2:
        sys.exit('FATAL: SATCAT matched only %d of %d — refusing to build' % (len(sc), len(active)))
    sc.sort(key=lambda x: int(x.split('|')[0]))
    uc = [ln.rstrip('\n') for ln in open(D('data', 'ucs.psv'), encoding='utf-8')
          if ln.strip() and int(ln.split('|', 1)[0]) in active]
    uc.sort(key=lambda x: int(x.split('|')[0]))
    blob = ('#S\n' + '\n'.join(sc) + '\n#U\n' + '\n'.join(uc)).encode()
    meta = 'const META_B64="%s";\n' % base64.b64encode(gzip.compress(blob, 9)).decode()

    tex = ''
    for fname, var in [('earth-day.jpg', 'EARTH_DAY'), ('earth-night.jpg', 'EARTH_NIGHT')]:
        raw = open(D('src', 'textures', fname), 'rb').read()
        tex += 'const %s="data:image/jpeg;base64,%s";\n' % (var, base64.b64encode(raw).decode())

    S = lambda f: open(D('src', f), encoding='utf-8').read()
    html = (S('head.html')
            + '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n'
            + '<script>\n' + S('vendor/satellite.min.js') + '\n</script>\n'
            + '<script>\n' + S('coast.js') + payload + meta + tex + S('tables.js') + '\n' + S('app.js') + '\n</script>\n'
            + '</body>\n</html>\n')
    os.makedirs(D('tracker'), exist_ok=True)
    open(D('tracker', 'index.html'), 'w', encoding='utf-8').write(html)
    print('tracker/index.html: %d bytes · %d satellites · satcat %d · ucs %d · tags %s · date %s'
          % (len(html), len(ids), len(sc), len(uc), {k: len(v) for k, v in tags.items()}, data_date))

if __name__ == '__main__':
    main()
