import re, sys, json
sys.path.insert(0, '/home/claude/digtunnel/i18n')
from jsstr import pieces, CYR
TAG = re.compile(r'(<[^>]*>)')
def segments(text):
    """Разбить кусок литерала на сегменты: теги/без кириллицы остаются, текст с кириллицей — к переводу.
    Возвращает список (is_tr, lead, core, trail)."""
    out = []
    for part in TAG.split(text):
        if part.startswith('<') or not CYR.search(part):
            out.append((False, part, '', '')); continue
        m = re.match(r'^(\s*)(.*?)(\s*)$', part, re.S)
        out.append((True, m.group(1), m.group(2), m.group(3)))
    return out
if __name__ == '__main__':
    W = '/home/claude/digtunnel/web/'
    seen = {}
    for f in ['config.js', 'game.js']:
        src = open(W + f).read()
        for a, b, t in pieces(src):
            for tr, l, c, r in segments(t):
                if tr: seen[c] = seen.get(c, 0) + 1
    # index.html: текст между тегами и атрибуты aria-label/alt/title
    html = open(W + 'index.html').read()
    body = html[html.index('<body'):]
    body = re.sub(r'<script[\s\S]*?</script>', '', body)
    for part in TAG.split(body):
        if part.startswith('<'):
            for m in re.finditer(r'(?:aria-label|title|alt)="([^"]*[А-Яа-яЁё][^"]*)"', part): seen[m.group(1)] = 1
        elif CYR.search(part): seen[part.strip()] = 1
    keys = list(seen)
    json.dump(keys, open('segs_ru.json', 'w'), ensure_ascii=False, indent=0)
    print(len(keys), sum(len(k) for k in keys))
