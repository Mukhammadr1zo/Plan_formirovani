# -*- coding: utf-8 -*-
"""book_rules.json -> extension/rules_data.js (kompakt qoidalar + strukturali izoh-altlar)."""
import json, re, sys
sys.stdout.reconfigure(encoding='utf-8')

doc = json.load(open('book_rules.json', encoding='utf-8'))
names = json.load(open('code2name.json', encoding='utf-8'))

og = []
for part, groups in doc['origin_groups'].items():
    for g in groups:
        og.append({'p': int(part), 'c': g['col'], 'rju': g['rju'], 'div': g['division'], 'r': g['ranges']})

sig2col = {}
for g in og:
    sig2col[(g['p'], json.dumps(g['r']))] = g['c']

rules = []
for r in doc['rules']:
    rules.append({'id': r['id'], 'p': r['part'],
                  'c': sig2col[(r['part'], json.dumps(r['origin_ranges']))],
                  'road': r['dest_road'].split('\n')[0][:60],
                  'dr': r['dest_ranges'], 'ch': [c['code'] for c in r['chain']]})

# --- izohlarni strukturali altlarga aylantirish (validate.py bilan bir xil mantiq) ---
def parse_note_alts(text):
    t = text.replace('\n', ' ')
    parts = re.split(r'(?=-\s*(?:порожние|груж[её]ные)?\s*со ст\.)', t)
    alts = []
    for p in parts:
        if 'через пункты перехода' not in p:
            continue
        m = re.search(r'через пункты перехода:(.*?)(?:Д-\d|$)', p)
        seg = m.group(1) if m else ''
        codes = re.findall(r'\((\d{5})\)', seg)
        dm = re.search(r'назн\s*\.?\s*на ст\.:?\s*([^:]*?)направить', p)
        dranges = [[int(a), int(b)] for a, b in re.findall(r'(\d{5})\s*-\s*(\d{5})', dm.group(1) if dm else '')]
        om = re.search(r'со ст\.:?\s*Узбк?\s*ж\.?д\.?\s*([\d\s,\-]*)', p)
        oranges = [[int(a), int(b)] for a, b in re.findall(r'(\d{5})\s*-\s*(\d{5})', om.group(1) if om else '')]
        porozh = bool(re.match(r'-\s*порожние', p.strip(), re.I))
        if codes:
            alts.append({'codes': codes, 'd': dranges, 'o': oranges, 'e': porozh})
    return alts

alts = []
for n in doc['notes']:
    for a in parse_note_alts(n['text']):
        a['rules'] = n['after_rules']
        alts.append(a)

data = {'og': og, 'rules': rules, 'names': names, 'alts': alts,
        'meta': {'book': 'BOOK_3_2025-10-23', 'built': '2026-08-27'}}
out = 'const BOOK3 = ' + json.dumps(data, ensure_ascii=False) + ';\n'
open('extension/rules_data.js', 'w', encoding='utf-8').write(out)
print('rules_data.js bytes:', len(out.encode('utf-8')), '| rules:', len(rules), '| alts:', len(alts))
