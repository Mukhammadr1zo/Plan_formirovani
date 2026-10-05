# -*- coding: utf-8 -*-
"""Book 3 (Uzbekistan section, tables 45-46) -> structured rules JSON."""
import json, re, sys
sys.stdout.reconfigure(encoding='utf-8')

RANGE_RE = re.compile(r'^\d{5}\s*-\s*\d{5}$')
CODE_RE = re.compile(r'^\d{5}$')

# rjuId mapping (from site Create form) -> book division names
DIV2RJU = {
    'Ташкентское отд.': 1,
    'Ферганское отд.': 2,   # Кокандский узел
    'Бухарское отд.': 3,
    'Кунградское отд.': 4,
    'Каршинское отд.': 5,
    'Термезское отд.': 6,
}

def parse_ranges(cell):
    """'72000-72540 / 72550-72690' -> [(72000,72540),(72550,72690)]"""
    out = []
    for line in cell.split('\n'):
        line = line.strip()
        for m in re.finditer(r'(\d{5})\s*-\s*(\d{5})', line):
            out.append((int(m.group(1)), int(m.group(2))))
    return out

def parse_chain(cell):
    """'КЕЛЕС-Э\n72060\nИЛЕЦК I-Э(КЗХ)\n66650' -> [('КЕЛЕС-Э','72060'),...] + leftovers"""
    lines = [l.strip() for l in cell.split('\n') if l.strip()]
    chain, leftovers, name = [], [], None
    for l in lines:
        if CODE_RE.match(l):
            if name is not None:
                chain.append({'name': name, 'code': l}); name = None
            else:
                chain.append({'name': '', 'code': l})
        else:
            if name is not None:
                # two name lines in a row: long name wrapped
                name = name + ' ' + l
            else:
                name = l
    if name is not None:
        # trailing name without code (e.g. 'пр 121' footnote ref)
        leftovers.append(name)
    return chain, leftovers

def extract_rules(grid, part):
    rules, notes, anomalies = [], [], []
    origin_groups = None   # list of {'col':i,'division':str,'rju':int,'ranges':[(a,b)]}
    divisions_row = None
    last_data_rule_ids = []
    for ri, row in enumerate(grid):
        c0 = row[0].replace('\n', ' ').strip()
        if len(set(row)) == 1:          # full-width (colspan=9) row: title, note or spacer
            if 'Узбекские ж.д' in c0 and 'Часть' in c0:
                continue                # repeated page title
            if c0:
                notes.append({'part': part, 'row': ri, 'text': row[0],
                              'after_rules': list(last_data_rule_ids)})
            continue
        # NOTE: rows whose dest_road starts with 'Узбекские ж.д.' but are NOT full-width
        # are genuine intra-UZ destination rows (transit via TM/KG) — keep them as data.
        if any(d in row[2] for d in DIV2RJU) and not RANGE_RE.search(row[2].split('\n')[0].strip()[:11]):
            divisions_row = row
            continue
        if c0 == 'Куда' or (row[1].strip() == 'Откуда'):
            # ranges header row
            if origin_groups is None:
                origin_groups = []
                for col in range(2, 9):
                    div = divisions_row[col].strip() if divisions_row else ''
                    origin_groups.append({
                        'col': col, 'division': div,
                        'rju': DIV2RJU.get(div, 0),
                        'ranges': parse_ranges(row[col]),
                    })
            continue
        if c0.startswith('Примечания'):
            notes.append({'part': part, 'row': ri, 'text': row[0],
                          'after_rules': list(last_data_rule_ids)})
            continue
        if not c0 and not row[1].strip():
            continue                     # spacer
        dest_ranges = parse_ranges(row[1])
        if not dest_ranges:
            anomalies.append({'part': part, 'row': ri, 'why': 'no dest ranges', 'c0': c0[:120], 'c1': row[1][:120]})
            continue
        # data row
        last_data_rule_ids = []
        for g in origin_groups:
            cell = row[g['col']]
            chain, leftovers = parse_chain(cell)
            rid = len(rules)
            last_data_rule_ids.append(rid)
            rules.append({
                'id': rid, 'part': part, 'row': ri,
                'dest_road': c0,
                'dest_ranges': dest_ranges,
                'origin_division': g['division'], 'rju': g['rju'],
                'origin_ranges': g['ranges'],
                'chain': chain,
                'leftovers': leftovers,
            })
            if leftovers:
                anomalies.append({'part': part, 'row': ri, 'why': 'leftover text in chain',
                                  'dest': c0[:80], 'leftovers': leftovers})
    return rules, notes, anomalies, origin_groups

all_rules, all_notes, all_anoms = [], [], []
groups_by_part = {}
for part, fn in ((1, 'grid45.json'), (2, 'grid46.json')):
    grid = json.load(open(fn, encoding='utf-8'))
    rules, notes, anoms, groups = extract_rules(grid, part)
    # re-id globally
    base = len(all_rules)
    for r in rules: r['id'] += base
    for n in notes: n['after_rules'] = [x + base for x in n['after_rules']]
    all_rules += rules; all_notes += notes; all_anoms += anoms
    groups_by_part[part] = groups
    print(f"part {part}: {len(rules)} rules, {len(notes)} notes, {len(anoms)} anomalies")

json.dump({'rules': all_rules, 'notes': all_notes, 'anomalies': all_anoms,
           'origin_groups': {str(k): v for k, v in groups_by_part.items()}},
          open('book_rules.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# quick sanity output
print("total rules:", len(all_rules))
for p, groups in groups_by_part.items():
    print(f" part {p} origin groups:")
    for g in groups:
        print(f"   col{g['col']} rju{g['rju']} {g['division']}: {g['ranges']}")
for a in all_anoms[:15]:
    print(" ANOM:", a)
