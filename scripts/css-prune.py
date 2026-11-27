# Takes out declarations that a later rule with the very same selector, in the same @media, sets again (they never
# show). Run after css-tidy.py: python3 scripts/css-prune.py [--dry]
import re, sys, os
exec(open(os.path.join(os.path.dirname(__file__), 'css-tidy.py')).read().split("used_cache = {}")[0].split("corpus = ''")[0])
src = open(os.path.join(os.path.dirname(__file__), 'css-tidy.py')).read()
# reuse parse / split_top
ns = {'__file__': os.path.join(os.path.dirname(os.path.abspath(__file__)), 'css-tidy.py')}
exec(src.split("total0 = total1 = 0")[0].replace("corpus = ''", "corpus = ''\nif False:"), ns) if False else None
exec(src.split("stats = {}")[0], ns)
parse, split_top = ns['parse'], ns['split_top']
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src')
DRY = '--dry' in sys.argv

def decls(body):
    out = []
    for d in split_top(body, ';'):
        d2 = d.strip()
        if not d2: continue
        if ':' not in d2: return None
        if '{' in d2 or '}' in d2: return None
        prop = d2.split(':', 1)[0].strip().lower()
        if '/*' in prop: return None
        imp = bool(re.search(r'!\s*important\s*$', d2, re.I))
        out.append((prop, imp, d))
    return out

def norm(sel): return ','.join(re.sub(r'\s+', ' ', s).strip() for s in split_top(sel))

edits = []
removed = [0]
def walk(text, a, b, ctx):
    rules = []
    for it in parse(text, a, b):
        if it[2] != 'block': continue
        start, end, _, prelude, bs = it
        p = prelude.strip()
        if p.startswith('@'):
            if re.match(r'@(media|supports|container|layer)\b', p):
                walk(text, bs + 1, end - 1, ctx + '|' + re.sub(r'\s+', ' ', p))
            continue
        body = text[bs + 1:end - 1]
        if '/*' in body: body_nc = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
        else: body_nc = body
        ds = decls(body_nc)
        rules.append((start, end, bs, norm(p), ds, body_nc))
    later = {}
    for start, end, bs, key, ds, body in reversed(rules):
        seen = later.setdefault(key, [set(), set()])
        if ds is None:
            continue
        keep, drop = [], 0
        for prop, imp, d in ds:
            if prop in seen[1] or (not imp and prop in seen[0]): drop += 1
            else: keep.append(d.strip())
        for prop, imp, d in ds:
            seen[1 if imp else 0].add(prop)
        if drop:
            removed[0] += drop
            if keep: edits.append((bs + 1, end - 1, ' ' + '; '.join(keep) + '; '))
            else: edits.append((start, end, ''))

total0 = total1 = 0
for f in ['styles.css', 'themes-halo.css', 'themes-glass.css', 'themes-frost.css']:
    path = os.path.join(SRC, f)
    text = open(path, encoding='utf8').read()
    edits.clear()
    walk(text, 0, len(text), '')
    new = text
    for s, e, rep in sorted(edits, key=lambda r: -r[0]):
        new = new[:s] + rep + new[e:]
    new = re.sub(r'@(media|supports|container)[^{};]*\{\s*\}', '', new)
    new = re.sub(r'\n{3,}', '\n\n', new)
    total0 += len(text.encode()); total1 += len(new.encode())
    print(f, len(text.encode()), '->', len(new.encode()))
    if not DRY: open(path, 'w', encoding='utf8').write(new)
print('total', total0, '->', total1, 'declarations dropped', removed[0])
