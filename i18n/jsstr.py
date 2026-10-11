"""Минимальный токенизатор JS: находит строковые литералы ('', "", ``) с учётом ${} внутри шаблонов.
Возвращает список (start, end, text) для кусков текста внутри литералов (без кавычек)."""
import re
CYR = re.compile('[А-Яа-яЁё]')

def scan(src):
    out = []  # (start, end) of literal text pieces
    i, n = 0, len(src)
    def skip_ws_comment(i):
        return i
    def read_template(i):
        # i указывает на символ после `
        start = i
        while i < n:
            c = src[i]
            if c == '\\': i += 2; continue
            if c == '`':
                out.append((start, i)); return i + 1
            if c == '$' and i + 1 < n and src[i+1] == '{':
                out.append((start, i))
                i = read_code(i + 2, '}')
                start = i
                continue
            i += 1
        raise ValueError('unterminated template')
    def read_quoted(i, q):
        start = i
        while i < n:
            c = src[i]
            if c == '\\': i += 2; continue
            if c == q: out.append((start, i)); return i + 1
            if c == '\n': raise ValueError('newline in string at %d' % i)
            i += 1
        raise ValueError('unterminated string')
    def read_code(i, end):
        depth = 0
        while i < n:
            c = src[i]
            if c == '/' and src[i+1:i+2] == '/':
                j = src.find('\n', i); i = n if j < 0 else j; continue
            if c == '/' and src[i+1:i+2] == '*':
                j = src.find('*/', i + 2); i = j + 2; continue
            if c == '/' :
                # регулярка? грубая эвристика: после ( , = : ! & | ? { } ; [ или в начале
                k = i - 1
                while k >= 0 and src[k] in ' \t\n': k -= 1
                if k < 0 or src[k] in '(,=:!&|?{};[+' :
                    j = i + 1; inclass = False
                    while j < n:
                        if src[j] == '\\': j += 2; continue
                        if src[j] == '[': inclass = True
                        elif src[j] == ']': inclass = False
                        elif src[j] == '/' and not inclass: break
                        elif src[j] == '\n': j = -1; break
                        j += 1
                    if j > 0:
                        i = j + 1
                        while i < n and src[i].isalpha(): i += 1
                        continue
            if c in '\'"': i = read_quoted(i + 1, c); continue
            if c == '`': i = read_template(i + 1); continue
            if c == '{': depth += 1
            elif c == '}':
                if depth == 0 and end == '}': return i + 1
                depth -= 1
            i += 1
        return i
    read_code(0, None)
    return out

def pieces(src):
    return [(a, b, src[a:b]) for a, b in scan(src) if CYR.search(src[a:b])]
