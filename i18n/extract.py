import json, sys, collections
sys.path.insert(0, '.')
from jsstr import pieces
W = '/home/claude/digtunnel/web/'
allp = collections.OrderedDict()
for f in ['config.js', 'game.js']:
    src = open(W + f).read()
    for a, b, t in pieces(src):
        allp.setdefault(t, 0); allp[t] += 1
print(len(allp), sum(len(k) for k in allp))
json.dump(list(allp.keys()), open('ru_js.json', 'w'), ensure_ascii=False, indent=0)
