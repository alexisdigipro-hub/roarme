# Takes out CSS rules for classes no code uses any more, rules of the old themes (data-theme other than stone,
# data-skin other than halo) and exact repeats (Alex, 27 Nov). Run from anywhere: python3 scripts/css-tidy.py [--dry]
import re, sys, os, glob, json
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src')
DRY = '--dry' in sys.argv

corpus = ''
for f in glob.glob(SRC + '/**/*.js', recursive=True) + glob.glob(SRC + '/**/*.jsx', recursive=True):
    corpus += open(f, encoding='utf8').read() + '\n'
for f in [os.path.join(SRC, '..', 'index.html')]:
    corpus += open(f, encoding='utf8').read()

# dynamic class prefixes: `x-${..}`, 'x-' + .., "x" + ..
prefixes = set()
short = set()
for m in re.finditer(r'([A-Za-z][\w-]*)\$\{', corpus): short.add(m.group(1))
for m in re.finditer(r"""['"`]([^'"`\n]*?)([A-Za-z][\w-]*)['"`]\s*\+""", corpus): prefixes.add(m.group(2))
tiny = {p for p in short if len(p) <= 2 and not p.endswith('-')}
prefixes = {p for p in prefixes | short if len(p) >= 3 or (len(p) >= 2 and p.endswith('-'))}
KEEP_PREFIX = ('leaflet', 'pdfjs', 'lk-', 'maplibre', 'mapboxgl', 'cm-')

used_cache = {}
def used(c):
    if c in used_cache: return used_cache[c]
    ok = bool(re.search(r'(?<![\w-])' + re.escape(c) + r'(?![\w-])', corpus)) or c.startswith(KEEP_PREFIX) or any(c.startswith(p) for p in prefixes) or any(re.fullmatch(re.escape(p) + r'\d+', c) for p in tiny)
    used_cache[c] = ok
    return ok

def strip_parens(sel):
    out, depth = [], 0
    for ch in sel:
        if ch == '(':
            depth += 1; continue
        if ch == ')':
            depth -= 1; continue
        if depth == 0: out.append(ch)
    return ''.join(out)

def strip_attr(sel):
    return re.sub(r'\[[^\]]*\]', '', sel)

def split_top(sel, sep=','):
    parts, depth, cur, q = [], 0, '', None
    for ch in sel:
        if q:
            cur += ch
            if ch == q: q = None
            continue
        if ch in '"\'': q = ch
        if ch in '([': depth += 1
        if ch in ')]': depth -= 1
        if ch == sep and depth == 0:
            parts.append(cur); cur = ''
        else: cur += ch
    parts.append(cur)
    return parts

DEAD_ATTR = re.compile(r"\[data-theme=['\"]?(?!stone['\"\]])[\w-]+['\"]?\]|\[data-skin=['\"]?(?!halo['\"\]])[\w-]+['\"]?\]")
def sel_dead(s):
    if DEAD_ATTR.search(strip_parens(s)): return True
    core = strip_attr(strip_parens(s))
    classes = re.findall(r'\.(-?[A-Za-z_][\w-]*)', core)
    return any(not used(c) for c in classes)

# parse: return list of (start, end, kind, prelude) for top-level items within text[a:b]
def parse(text, a, b):
    items, i = [], a
    while i < b:
        # skip ws and comments
        while i < b:
            if text[i].isspace(): i += 1
            elif text.startswith('/*', i):
                j = text.find('*/', i + 2); i = (j + 2) if j >= 0 else b
            else: break
        if i >= b: break
        start = i
        # read prelude until { or ;
        q = None; depth = 0
        while i < b:
            ch = text[i]
            if q:
                if ch == '\\': i += 2; continue
                if ch == q: q = None
                i += 1; continue
            if ch in '"\'': q = ch
            elif text.startswith('/*', i):
                j = text.find('*/', i + 2); i = j + 2; continue
            elif ch == '(': depth += 1
            elif ch == ')': depth -= 1
            elif depth == 0 and ch in '{;': break
            i += 1
        if i >= b: break
        prelude = text[start:i]
        if text[i] == ';':
            items.append((start, i + 1, 'stmt', prelude)); i += 1; continue
        # block: match braces
        bs = i; d = 0; q = None
        while i < b:
            ch = text[i]
            if q:
                if ch == '\\': i += 2; continue
                if ch == q: q = None
                i += 1; continue
            if ch in '"\'': q = ch
            elif text.startswith('/*', i):
                j = text.find('*/', i + 2); i = j + 2; continue
            elif ch == '{': d += 1
            elif ch == '}':
                d -= 1
                if d == 0: break
            i += 1
        items.append((start, i + 1, 'block', prelude, bs))
        i += 1
    return items

stats = {}
def process(text, a, b, removals, ctx=''):
    items = parse(text, a, b)
    seen = {}
    for it in items:
        if it[2] != 'block': continue
        start, end, _, prelude, bs = it
        p = prelude.strip()
        if p.startswith('@'):
            if re.match(r'@(media|supports|container|layer)\b', p):
                process(text, bs + 1, end - 1, removals, ctx + p)
            continue
        sels = split_top(p)
        body = re.sub(r'\s+', ' ', text[bs + 1:end - 1]).strip()
        alive = [s for s in sels if not sel_dead(s)]
        if not alive:
            removals.append((start, end, None)); stats['rules'] = stats.get('rules', 0) + 1; continue
        if len(alive) < len(sels):
            removals.append((start, bs, ',\n'.join(x.strip() for x in alive) + ' ')); stats['sels'] = stats.get('sels', 0) + len(sels) - len(alive)
        key = (','.join(x.strip() for x in alive), body)
        if key in seen:
            # an exact repeat in the same place: the earlier copy changes nothing
            removals.append(seen[key]); stats['dupes'] = stats.get('dupes', 0) + 1
        seen[key] = (start, end, None)
    # also drop @media blocks emptied entirely are handled after

def empty_blocks(text):
    # remove @media/@supports/@container blocks left with only whitespace/comments
    pat = re.compile(r'@(media|supports|container)[^{};]*\{\s*\}')
    n = 0
    while True:
        text2, k = pat.subn('', text)
        n += k
        if not k: return text2, n
        text = text2

def tidy(path):
    text = open(path, encoding='utf8').read()
    removals = []
    process(text, 0, len(text), removals)
    # dedupe overlapping removals; apply from end
    removals = sorted(set(removals), key=lambda r: (r[0], -r[1]))
    out, last = [], len(text)
    keep = []
    for r in removals:
        if keep and r[0] < keep[-1][1] and r[2] is None and keep[-1][2] is None: continue
        if keep and r[0] < keep[-1][1]:
            # a prune inside a removed rule: skip it
            if keep[-1][2] is None: continue
        keep.append(r)
    new = text
    for s, e, rep in sorted(keep, key=lambda r: -r[0]):
        if rep is None:
            # remove the rule plus the comment line just above it? keep comments
            new = new[:s] + new[e:]
        else:
            new = new[:s] + rep + new[e:]
    new, k = empty_blocks(new)
    new = re.sub(r'\n{3,}', '\n\n', new)
    return text, new

total0 = total1 = 0
for f in ['styles.css', 'themes-halo.css', 'themes-glass.css', 'themes-frost.css']:
    p = os.path.join(SRC, f)
    a, b = tidy(p)
    total0 += len(a.encode()); total1 += len(b.encode())
    print(f, len(a.encode()), '->', len(b.encode()))
    if not DRY: open(p, 'w', encoding='utf8').write(b)
print('total', total0, '->', total1, stats)
