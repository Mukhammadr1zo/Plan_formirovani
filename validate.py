# -*- coding: utf-8 -*-
"""Cross-validate e-nakl ListPlanExport rows (plan_rows.json) against Book 3 rules (book_rules.json)."""
import json, re, sys, collections
sys.stdout.reconfigure(encoding='utf-8')

rules_doc = json.load(open('book_rules.json', encoding='utf-8'))
RULES = rules_doc['rules']
NOTES = rules_doc['notes']
ROWS = json.load(open('plan_rows.json', encoding='utf-8'))

ROAD2STRANA = [
    ('Октябрьская', '20'), ('Калининградская', '20'), ('Московская', '20'),
    ('Горьковская', '20'), ('Северная', '20'), ('Северо-Кавказская', '20'),
    ('Юго-Восточная', '20'), ('Приволжская', '20'), ('Куйбышевская', '20'),
    ('Свердловская', '20'), ('Южно-Уральская', '20'), ('Западно-Сибирская', '20'),
    ('Красноярская', '20'), ('Восточно-Сибирская', '20'), ('Забайкальская', '20'),
    ('Дальневосточная', '20'), ('Якутии', '20'), ('Рубикон', '20'),
    ('Крымская', '20'), ('Мелитопольская', '20'), ('Луганский филиал', '20'),
    ('Донецкий филиал', '20'),
    ('Белорусская', '21'),
    ('Юго-Западная', '22'), ('Львовская', '22'), ('Одесская', '22'),
    ('Южная', '22'), ('Приднепровская', '22'), ('Донецкая', '22'),
    ('Молдавская', '23'), ('Литовские', '24'), ('Латвийская', '25'),
    ('Эстонская', '26'), ('Казахстанская', '27'), ('Грузинская', '28'),
    ('Азербайджанская', '57'), ('Южно-Кавказская', '58'), ('Кыргызская', '59'),
    ('Таджикская', '66'), ('Туркменская', '67'), ('Узбекские', '29'),
]
# ponytail: 14800 (Gomel tuguni) 3-kitob diapazonlarida tirqish — 14803 qatoriga yopishtiramiz
DEST_ALIAS = {14800: 14803}
def road_strana(road_name):
    for pat, s in ROAD2STRANA:
        if pat in road_name:
            return s
    return None

# ---- index origin groups ----
# group key: (part, col); rules already carry origin_ranges/rju/part + col via origin_division? need col; recover from origin_groups
OG = []   # {'part','col','rju','division','ranges'}
for part, groups in rules_doc['origin_groups'].items():
    for g in groups:
        OG.append({'part': int(part), 'col': g['col'], 'rju': g['rju'],
                   'division': g['division'], 'ranges': [tuple(r) for r in g['ranges']]})

def find_origin_groups(a, b):
    """groups whose ranges contain BOTH a and b (same group)."""
    hits = []
    for g in OG:
        ina = any(lo <= a <= hi for lo, hi in g['ranges'])
        inb = any(lo <= b <= hi for lo, hi in g['ranges'])
        if ina and inb:
            hits.append(g)
    return hits

def find_origin_any(x):
    return [g for g in OG if any(lo <= x <= hi for lo, hi in g['ranges'])]

# rules indexed by (part, origin_division-col). Rules lack col; rebuild: rules were emitted per origin group in order of groups list.
# Safer: match by (part, origin_ranges) signature.
sig2col = {}
for g in OG:
    sig2col[(g['part'], tuple(g['ranges']))] = g['col']
for r in RULES:
    r['col'] = sig2col[(r['part'], tuple(tuple(x) for x in r['origin_ranges']))]

RULES_BY_PC = collections.defaultdict(list)
for r in RULES:
    RULES_BY_PC[(r['part'], r['col'])].append(r)

NOTE_BY_RULE = collections.defaultdict(list)
for n in NOTES:
    for rid in n['after_rules']:
        NOTE_BY_RULE[rid].append(n['text'])

# ---- structured alt-rules from notes ----
BULLET_RE = re.compile(r'-\s*(порожние|груж[её]ные)?\s*со ст', re.I)
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
        dseg = dm.group(1) if dm else ''
        dranges = [(int(a), int(b)) for a, b in re.findall(r'(\d{5})\s*-\s*(\d{5})', dseg)]
        om = re.search(r'со ст\.:?\s*Узбк?\s*ж\.?д\.?\s*([\d\s,\-]*)', p)
        oseg = om.group(1) if om else ''
        oranges = [(int(a), int(b)) for a, b in re.findall(r'(\d{5})\s*-\s*(\d{5})', oseg)]
        porozh = bool(re.match(r'-\s*порожние', p.strip(), re.I))
        if codes:
            alts.append({'codes': codes, 'dest_ranges': dranges, 'origin_ranges': oranges,
                         'porozhnie': porozh, 'text': p.strip()[:400]})
    return alts

ALTS_BY_RULE = {}
for rid, texts in NOTE_BY_RULE.items():
    alts = []
    for t in texts:
        alts.extend(parse_note_alts(t))
    ALTS_BY_RULE[rid] = alts

def site_chain(punkts):
    """'1-736808, 2-662002' -> ['73680','66200'] ordered by N"""
    items = []
    for tok in (punkts or '').split(','):
        tok = tok.strip()
        m = re.match(r'^(\d+)\s*-\s*(\d+)$', tok)
        if not m:
            if tok:
                items.append((999, tok))
            continue
        n, code = int(m.group(1)), m.group(2)
        if len(code) == 6:
            code = code[:5]
        items.append((n, code))
    items.sort(key=lambda x: x[0])
    return [c for _, c in items]

def book_chain(rule):
    return [c['code'] for c in rule['chain']]

# ---- validate every site row ----
results = []
for row in ROWS:
    rid = row['id']
    res = {'id': rid, 'row': row, 'status': None, 'detail': {}}
    a, b = int(row['sendStationBegin']), int(row['sendStationEnd'])
    ra, rb = int(row['receiveStationBegin']), int(row['receiveStationEnd'])
    rju = row['sendRjuId']
    actual = site_chain(row['punktsConcat'])
    res['detail']['actual_chain'] = actual

    flags = []
    if a > b: flags.append('SEND_RANGE_INVERTED')
    if ra > rb: flags.append('RECV_RANGE_INVERTED')
    if len(row['sendStationBegin']) != 5 or len(row['sendStationEnd']) != 5:
        flags.append('SEND_CODE_NOT_5_DIGITS')
    if len(row['receiveStationBegin']) != 5 or len(row['receiveStationEnd']) != 5:
        flags.append('RECV_CODE_NOT_5_DIGITS')
    if len(actual) != len(set(actual)):
        flags.append('DUPLICATE_PUNKT')
    res['detail']['flags'] = flags
    if flags and ('SEND_CODE_NOT_5_DIGITS' in flags or 'RECV_CODE_NOT_5_DIGITS' in flags
                  or 'SEND_RANGE_INVERTED' in flags or 'RECV_RANGE_INVERTED' in flags):
        res['status'] = 'BAD_INPUT_DATA'
        results.append(res); continue

    ra = DEST_ALIAS.get(ra, ra)
    rb = DEST_ALIAS.get(rb, rb)
    if (ra, rb) != (int(row['receiveStationBegin']), int(row['receiveStationEnd'])):
        res['detail']['dest_alias'] = f"{row['receiveStationBegin']}-{row['receiveStationEnd']} -> {ra}-{rb} (kitob diapazon tirqishi)"

    groups = find_origin_groups(a, b)
    if not groups:
        ga, gb = find_origin_any(a), find_origin_any(b)
        res['status'] = 'ORIGIN_SPLIT' if (ga and gb) else 'ORIGIN_NOT_FOUND'
        res['detail']['origin_a'] = [(g['part'], g['col'], g['division']) for g in ga]
        res['detail']['origin_b'] = [(g['part'], g['col'], g['division']) for g in gb]
        results.append(res); continue
    if len(groups) > 1:
        res['detail']['ambiguous_origin'] = [(g['part'], g['col']) for g in groups]
    g = groups[0]
    res['detail']['origin'] = {'part': g['part'], 'col': g['col'], 'division': g['division'], 'book_rju': g['rju']}
    if g['rju'] != rju:
        res['status'] = 'WRONG_RJU'
        res['detail']['site_rju'] = rju
        results.append(res); continue

    # destination match among rules of this origin group
    cand = RULES_BY_PC[(g['part'], g['col'])]
    hits = [r for r in cand
            if any(lo <= ra <= hi for lo, hi in r['dest_ranges'])
            and any(lo <= rb <= hi for lo, hi in r['dest_ranges'])]
    if not hits:
        # fallback: rules whose dest ranges INTERSECT [ra, rb]
        inter = [r for r in cand
                 if any(lo <= rb and ra <= hi for lo, hi in r['dest_ranges'])]
        chains = {tuple(book_chain(r)) for r in inter}
        res['detail']['intersecting_rules'] = [(r['id'], r['dest_road'].split('\n')[0][:60], book_chain(r)) for r in inter[:5]]
        if inter and len(chains) == 1:
            exp = list(next(iter(chains)))
            res['detail']['expected_chain'] = exp
            res['detail']['dest_road'] = inter[0]['dest_road'].split('\n')[0]
            if actual == exp:
                res['status'] = 'OK_RANGE_MISALIGNED'   # chain to'g'ri, lekin diapazon kitob bo'linishiga mos emas
            else:
                res['status'] = 'CHAIN_MISMATCH'
                res['detail']['range_issue'] = True
                res['detail']['diffs'] = [
                    {'pos': i + 1,
                     'actual': actual[i] if i < len(actual) else None,
                     'expected': exp[i] if i < len(exp) else None}
                    for i in range(max(len(actual), len(exp)))
                    if (actual[i] if i < len(actual) else None) != (exp[i] if i < len(exp) else None)]
        elif inter:
            res['status'] = 'DEST_RANGE_AMBIGUOUS'      # kesishgan qoidalar zanjirlari har xil
        else:
            res['status'] = 'DEST_NOT_FOUND'
        results.append(res); continue
    if len(hits) > 1:
        res['detail']['ambiguous_dest'] = [(r['id'], r['dest_road'][:60]) for r in hits]
    rule = hits[0]
    res['detail']['rule_id'] = rule['id']
    res['detail']['dest_road'] = rule['dest_road'].split('\n')[0]
    res['detail']['expected_chain'] = book_chain(rule)
    res['detail']['expected_names'] = [c['name'] for c in rule['chain']]

    # strana check
    bs = road_strana(rule['dest_road'])
    if bs and bs != row['receiveStranaCode']:
        res['status'] = 'STRANA_MISMATCH'
        res['detail']['book_strana'] = bs
        results.append(res); continue

    exp = book_chain(rule)
    if not exp:
        # kitob katakchasi bo'sh — sof ichki yo'nalish, 3-kitob qoidasi talab qilinmaydi
        res['status'] = 'DOMESTIC_NO_RULE_NEEDED'
        results.append(res); continue
    if actual == exp:
        res['status'] = 'OK'
    else:
        # try alt chains from notes attached to this rule (and porojnie variants)
        def is_subseq(short, long_):
            it = iter(long_)
            return all(x in it for x in short)
        alts = ALTS_BY_RULE.get(rule['id'], [])
        alt_hit = alt_partial = None
        for altr in alts:
            ok_o = (not altr['origin_ranges']) or any(lo <= a <= hi and lo <= b <= hi for lo, hi in altr['origin_ranges'])
            ok_d = (not altr['dest_ranges']) or any(lo <= ra <= hi and lo <= rb <= hi for lo, hi in altr['dest_ranges'])
            if not (ok_o and ok_d):
                continue
            if actual == altr['codes']:
                alt_hit = altr; break
            if alt_partial is None and len(actual) >= 2 and is_subseq(actual, altr['codes']):
                alt_partial = altr
        if alt_hit:
            res['status'] = 'OK_BY_NOTE'
            res['detail']['note'] = alt_hit['text'][:300]
            res['detail']['porozhnie'] = alt_hit['porozhnie']
        elif alt_partial:
            # sayt zanjiri izohdagi zanjirning qisqartmasi (oraliq punktlar tushirilgan)
            res['status'] = 'CHAIN_BY_NOTE_PARTIAL'
            res['detail']['note'] = alt_partial['text'][:300]
            res['detail']['note_chain'] = alt_partial['codes']
        else:
            res['status'] = 'CHAIN_MISMATCH'
            # positional diff
            diffs = []
            for i in range(max(len(actual), len(exp))):
                av = actual[i] if i < len(actual) else None
                ev = exp[i] if i < len(exp) else None
                if av != ev:
                    diffs.append({'pos': i + 1, 'actual': av, 'expected': ev})
            res['detail']['diffs'] = diffs
    results.append(res)

# ---- summary ----
cnt = collections.Counter(r['status'] for r in results)
print("=== STATUS SUMMARY ===")
for k, v in cnt.most_common():
    print(f"  {k}: {v}")

json.dump(results, open('audit_results.json', 'w', encoding='utf-8'), ensure_ascii=False)

# samples per status
print("\n=== SAMPLES ===")
seen = collections.Counter()
for r in results:
    st = r['status']
    if seen[st] >= 3 or st == 'OK':
        continue
    seen[st] += 1
    row = r['row']
    print(f"\n[{st}] id={r['id']} rju={row['sendRjuId']} send {row['sendStationBegin']}-{row['sendStationEnd']} "
          f"-> strana {row['receiveStranaCode']} recv {row['receiveStationBegin']}-{row['receiveStationEnd']}")
    print(f"   actual:   {r['detail'].get('actual_chain')}")
    if 'expected_chain' in r['detail']:
        print(f"   expected: {r['detail']['expected_chain']} ({r['detail'].get('dest_road','')[:50]})")
    if 'diffs' in r['detail']:
        print(f"   diffs: {r['detail']['diffs'][:4]}")
    for k in ('origin_a', 'origin_b', 'dest_a', 'dest_b', 'book_strana', 'site_rju', 'origin'):
        if k in r['detail']:
            print(f"   {k}: {r['detail'][k]}")
