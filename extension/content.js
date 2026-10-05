/* E-Nakl Book-3 Tekshiruvchi — ListPlanExport jadval qatorlarini 3-kitob bilan solishtiradi. */
(function () {
  'use strict';
  const PATH = location.pathname;
  if (!PATH.includes('/Marshurt/ListPlanExport') && !PATH.includes('/Marshurt/EditPlanExport')) return;

  const RJU_OK = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
  const STRANA_BY_ROAD = [
    ['Октябрьская', '20'], ['Калининградская', '20'], ['Московская', '20'], ['Горьковская', '20'],
    ['Северная', '20'], ['Северо-Кавказская', '20'], ['Юго-Восточная', '20'], ['Приволжская', '20'],
    ['Куйбышевская', '20'], ['Свердловская', '20'], ['Южно-Уральская', '20'], ['Западно-Сибирская', '20'],
    ['Красноярская', '20'], ['Восточно-Сибирская', '20'], ['Забайкальская', '20'], ['Дальневосточная', '20'],
    ['Якутии', '20'], ['Рубикон', '20'], ['Крымская', '20'], ['Мелитопольская', '20'], ['Луганский филиал', '20'],
    ['Белорусская', '21'], ['Юго-Западная', '22'], ['Львовская', '22'], ['Одесская', '22'], ['Южная', '22'],
    ['Приднепровская', '22'], ['Донецкая', '22'], ['Молдавская', '23'], ['Литовские', '24'],
    ['Латвийская', '25'], ['Эстонская', '26'], ['Казахстанская', '27'], ['Грузинская', '28'],
    ['Азербайджанская', '57'], ['Южно-Кавказская', '58'], ['Кыргызская', '59'],
    ['Таджикская', '66'], ['Туркменская', '67'], ['Узбекские', '29'],
  ];
  // ponytail: 14800 (Gomel tuguni) kitob diapazonlarida tirqish — 14803 qatoriga yopishtiramiz
  const DEST_ALIAS = { 14800: 14803 };
  const roadStrana = road => (STRANA_BY_ROAD.find(([p]) => road.includes(p)) || [])[1] || null;
  const inR = (x, ranges) => ranges.some(([a, b]) => a <= x && x <= b);
  const nm = c => (BOOK3.names[c] || '?') + ' (' + c + ')';
  const chainStr = ch => ch.map(nm).join(' → ');

  function siteChain(punktsText) {
    const items = [];
    punktsText.split(/[,\n]/).forEach(tok => {
      const m = tok.trim().match(/^(\d+)\s*-\s*(\d+)$/);
      if (!m) return;
      let code = m[2];
      if (code.length === 6) code = code.slice(0, 5);
      items.push([parseInt(m[1], 10), code]);
    });
    items.sort((a, b) => a[0] - b[0]);
    return items.map(x => x[1]);
  }

  function validate(row) {
    // row: {sendBegin,sendEnd,rju,recvStrana,recvBegin,recvEnd,punkts}
    const a = parseInt(row.sendBegin, 10), b = parseInt(row.sendEnd, 10);
    let ra = parseInt(row.recvBegin, 10), rb = parseInt(row.recvEnd, 10);
    ra = DEST_ALIAS[ra] || ra; rb = DEST_ALIAS[rb] || rb;
    const actual = siteChain(row.punkts);
    const bad = [];
    if (a > b) bad.push("диапазон отправления перевёрнут (начало > конца)");
    if (ra > rb) bad.push('диапазон приёма перевёрнут (начало > конца)');
    if (row.sendBegin.length !== 5 || row.sendEnd.length !== 5) bad.push("код отправления не 5-значный");
    if (row.recvBegin.length !== 5 || row.recvEnd.length !== 5) bad.push('код приёма не 5-значный');
    if (new Set(actual).size !== actual.length) bad.push('дубликат пункта перехода');
    if (bad.length) return { st: 'BAD', msg: "Грубая ошибка ввода: " + bad.join('; '), actual };

    const groups = BOOK3.og.filter(g => inR(a, g.r) && inR(b, g.r));
    if (!groups.length) return { st: 'ERR', msg: "Диапазон отправления не попадает ни в одну колонку отделений Книги 3", actual };
    const g = groups[0];
    if (g.rju !== parseInt(row.rju, 10))
      return { st: 'ERR', msg: `Отделение не совпадает: по книге этот диапазон — ${g.div}`, actual };

    const cand = BOOK3.rules.filter(r => r.p === g.p && r.c === g.c);
    let hits = cand.filter(r => inR(ra, r.dr) && inR(rb, r.dr));
    let rangeNote = '';
    if (!hits.length) {
      const inter = cand.filter(r => r.dr.some(([lo, hi]) => lo <= rb && ra <= hi));
      if (!inter.length) return { st: 'ERR', msg: 'Диапазон приёма не найден в Книге 3', actual };
      const chains = new Set(inter.map(r => r.ch.join('-')));
      if (chains.size > 1)
        return { st: 'ERR', msg: 'Диапазон пересекает строки книги с разными цепочками — запись нужно разделить: ' +
                 inter.slice(0, 3).map(r => r.road + ': ' + r.ch.join('-')).join(' | '), actual };
      hits = [inter[0]];
      rangeNote = ' (диапазон не совпадает с разбивкой книги, но цепочка едина)';
    }
    const rule = hits[0];
    const bs = roadStrana(rule.road);
    if (bs && bs !== row.recvStrana)
      return { st: 'ERR', msg: `Код дороги не совпадает: по книге этот диапазон — ${rule.road} (страна ${bs})`, actual, rule };

    if (!rule.ch.length)
      return { st: 'INTRA', msg: "Чисто внутренний маршрут — правило Книги 3 не требуется (ячейка книги пуста)", actual, rule };

    if (actual.join(',') === rule.ch.join(','))
      return { st: rangeNote ? 'WARN' : 'OK', msg: (rangeNote ? 'Цепочка верна' + rangeNote : 'Соответствует книге'), actual, rule };

    // дополнительный план из Примечаний — строго по области действия примечания (диапазоны отправления/назначения)
    const isSubseq = (short, long_) => {
      let j = 0;
      for (const x of short) { j = long_.indexOf(x, j); if (j < 0) return false; j++; }
      return true;
    };
    let notePartial = null;
    for (const alt of BOOK3.alts) {
      if (!alt.rules.includes(rule.id)) continue;
      if (alt.o.length && !(inR(a, alt.o) && inR(b, alt.o))) continue;
      if (alt.d.length && !(inR(ra, alt.d) && inR(rb, alt.d))) continue;
      if (actual.join(',') === alt.codes.join(','))
        return { st: 'NOTE', msg: 'Дополнительный план: маршрут соответствует Примечанию к строке книги' + (alt.e ? ' (для порожних)' : ''), actual, rule };
      if (!notePartial && actual.length >= 2 && isSubseq(actual, alt.codes)) notePartial = alt;
    }
    if (notePartial)
      return { st: 'NOTE', msg: 'Дополнительный план по Примечанию, но пропущены промежуточные пункты; полная цепочка из примечания: ' + chainStr(notePartial.codes), actual, rule };

    // справочник согласованных отклонений (localStorage, для этого компьютера)
    const apprKey = rule.id + '|' + actual.join(',');
    const appr = APPROVALS[apprKey];
    if (appr)
      return { st: 'APPR', msg: 'Согласованное отклонение: ' + (appr.note || 'без основания'), actual, rule, apprKey };

    const diffs = [];
    const L = Math.max(actual.length, rule.ch.length);
    for (let i = 0; i < L; i++)
      if (actual[i] !== rule.ch[i]) diffs.push(`поз. ${i + 1}: ${actual[i] ? nm(actual[i]) : '—'} ≠ ${rule.ch[i] ? nm(rule.ch[i]) : '—'}`);
    return { st: 'ERR', msg: `Цепочка не соответствует книге (${rule.road}). По книге: ${chainStr(rule.ch)}. Расхождение: ${diffs.join('; ')}`, actual, rule, apprKey };
  }

  // ---- согласованные отклонения + база «известных» ID ----
  let APPROVALS = {};
  const loadApprovals = () => { try { APPROVALS = JSON.parse(lsGet('bk3_appr') || '{}'); } catch (e) { APPROVALS = {}; } };
  const saveApprovals = () => lsSet('bk3_appr', JSON.stringify(APPROVALS));
  let KNOWN_IDS = null;
  const loadKnown = () => { try { const a = JSON.parse(lsGet('bk3_known') || 'null'); KNOWN_IDS = a ? new Set(a) : null; } catch (e) { KNOWN_IDS = null; } };
  const saveKnown = ids => { KNOWN_IDS = new Set(ids); lsSet('bk3_known', JSON.stringify([...KNOWN_IDS])); };

  const CLS = { OK: 'bk3-ok', WARN: 'bk3-warn', NOTE: 'bk3-note', APPR: 'bk3-appr', ERR: 'bk3-err', BAD: 'bk3-err', INTRA: 'bk3-intra' };
  const ALL_CLS = ['bk3-ok', 'bk3-warn', 'bk3-note', 'bk3-appr', 'bk3-err', 'bk3-intra'];

  function processTable() {
    const table = document.getElementById('table1');
    if (!table) return;
    loadApprovals();
    if (KNOWN_IDS === null) loadKnown();
    let ok = 0, warn = 0, note = 0, appr = 0, err = 0, intra = 0;
    table.querySelectorAll('tbody tr').forEach(tr => {
      const td = tr.querySelectorAll('td');
      if (td.length < 9) return;
      const row = {
        id: td[0].textContent.trim(),
        sendBegin: td[2].textContent.trim(), sendEnd: td[3].textContent.trim(),
        rju: td[4].textContent.trim(),
        recvStrana: td[5].textContent.trim(),
        recvBegin: td[6].textContent.trim(), recvEnd: td[7].textContent.trim(),
        punkts: td[8].innerText.replace(/[✓✗△◆·].*$/s, '').trim(),
      };
      const v = validate(row);
      tr.classList.remove(...ALL_CLS);
      tr.classList.add(CLS[v.st]);
      tr.dataset.bk3 = v.st;
      let badge = tr.querySelector('.bk3-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'bk3-badge';
        td[8].appendChild(badge);
      }
      badge.textContent = { OK: '✓ Соответствует книге', WARN: '△ ' + v.msg, NOTE: '◆ ' + v.msg, APPR: '◉ ' + v.msg, ERR: '✗ ' + v.msg, BAD: '✗ ' + v.msg, INTRA: '· ' + v.msg }[v.st];
      badge.title = v.rule ? 'Книга: ' + v.rule.road + ' → ' + chainStr(v.rule.ch) : v.msg;
      // yangi yozuv belgisi (oxirgi sverkadan keyin paydo bo'lgan)
      if (KNOWN_IDS && !KNOWN_IDS.has(parseInt(row.id, 10))) {
        const chip = document.createElement('span');
        chip.className = 'bk3-newchip';
        chip.textContent = 'НОВАЯ';
        chip.title = 'Запись появилась после последней полной сверки (кнопка «Прогресс» или выгрузка обновляют базу)';
        badge.prepend(chip);
      }
      // kelishilgan chetlanishlar boshqaruvi
      if (v.st === 'ERR' && v.apprKey) {
        const a = document.createElement('a');
        a.href = '#'; a.className = 'bk3-apprlink'; a.textContent = 'согласовать отклонение';
        a.title = 'Пометить это отклонение как согласованное (например, приказом/телеграммой) — строка перестанет считаться ошибкой на этом компьютере';
        a.addEventListener('click', ev => {
          ev.preventDefault();
          const noteTxt = prompt('Основание согласования (номер приказа/телеграммы):');
          if (noteTxt === null) return;
          APPROVALS[v.apprKey] = { note: noteTxt.trim(), date: new Date().toISOString().slice(0, 10) };
          saveApprovals(); processTable();
        });
        badge.append(' · ', a);
      } else if (v.st === 'APPR') {
        const a = document.createElement('a');
        a.href = '#'; a.className = 'bk3-apprlink'; a.textContent = 'отменить';
        a.title = 'Убрать согласование — строка снова будет считаться ошибкой';
        a.addEventListener('click', ev => {
          ev.preventDefault();
          delete APPROVALS[v.apprKey];
          saveApprovals(); processTable();
        });
        badge.append(' · ', a);
      }
      if (v.st === 'OK') ok++; else if (v.st === 'WARN') warn++; else if (v.st === 'NOTE') note++;
      else if (v.st === 'APPR') appr++; else if (v.st === 'INTRA') intra++; else err++;
    });
    renderPanel(ok, warn, note, appr, err, intra);
  }

  // ---- ko'chiriladigan panel: drag + minimize, holat localStorage'da saqlanadi ----
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  function placeEl(el, x, y, key) {
    x = Math.max(4, Math.min(x, window.innerWidth - el.offsetWidth - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - el.offsetHeight - 4));
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.right = 'auto'; el.style.bottom = 'auto';
    if (key) lsSet(key, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
  }

  function restorePos(el, key) {
    const raw = lsGet(key);
    if (!raw) return;
    try { const p = JSON.parse(raw); placeEl(el, p.x, p.y, null); } catch (e) {}
  }

  function makeDraggable(el, handle, key, state) {
    handle.addEventListener('pointerdown', e => {
      if (el.id === 'bk3-panel' && e.target.closest('button')) return; // panel tugmalari drag emas
      const r = el.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY, ox = r.left, oy = r.top;
      state.dragged = false;
      const onMove = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!state.dragged && Math.abs(dx) + Math.abs(dy) < 6) return;
        state.dragged = true;
        placeEl(el, ox + dx, oy + dy, key);
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      e.preventDefault();
    });
  }

  function setMinimized(min) {
    document.getElementById('bk3-panel').style.display = min ? 'none' : 'block';
    document.getElementById('bk3-fab').style.display = min ? 'flex' : 'none';
    lsSet('bk3_min', min ? '1' : '0');
  }

  function renderPanel(ok, warn, note, appr, err, intra) {
    let p = document.getElementById('bk3-panel');
    if (!p) {
      p = document.createElement('div');
      p.id = 'bk3-panel';
      p.innerHTML = `<div id="bk3-head" title="Перетащите, чтобы переместить панель">
          <span class="bk3-grip">⠿</span><b>Проверка по Книге 3</b>
          <button id="bk3-min" type="button" title="Свернуть в кнопку">—</button>
        </div>
        <span id="bk3-stats"></span>
        <div class="bk3-btns">
          <button id="bk3-approve" type="button">✓ Подтвердить соответствующие</button>
          <button id="bk3-export" type="button" class="bk3-secondary">⬇ Ошибки в Excel (все страницы)</button>
          <button id="bk3-stat" type="button" class="bk3-secondary">📊 Прогресс</button>
          <button id="bk3-onlyerr" type="button" class="bk3-secondary">Только проблемные</button>
        </div>
        <div id="bk3-progress"></div>`;
      document.body.appendChild(p);

      const fab = document.createElement('div');
      fab.id = 'bk3-fab';
      fab.title = 'Проверка по Книге 3 — развернуть панель (можно перетаскивать)';
      fab.innerHTML = `<span>К3</span><i id="bk3-fabbadge"></i>`;
      document.body.appendChild(fab);

      document.getElementById('bk3-approve').addEventListener('click', approveVisibleOK);
      document.getElementById('bk3-export').addEventListener('click', exportErrorsCsv);
      document.getElementById('bk3-stat').addEventListener('click', showProgress);
      document.getElementById('bk3-onlyerr').addEventListener('click', function () {
        document.body.classList.toggle('bk3-hideok');
        this.classList.toggle('bk3-toggled');
        this.textContent = document.body.classList.contains('bk3-hideok') ? 'Показать все' : 'Только проблемные';
      });
      document.getElementById('bk3-min').addEventListener('click', () => setMinimized(true));

      const fabState = { dragged: false };
      makeDraggable(p, document.getElementById('bk3-head'), 'bk3_pos', { dragged: false });
      makeDraggable(fab, fab, 'bk3_fabpos', fabState);
      fab.addEventListener('click', () => { if (!fabState.dragged) setMinimized(false); });

      restorePos(p, 'bk3_pos');
      restorePos(fab, 'bk3_fabpos');
      if (lsGet('bk3_min') === '1') setMinimized(true);
    }
    document.getElementById('bk3-stats').textContent =
      `На странице: ${ok} соотв., ${note} по примечанию, ${appr} согласовано, ${warn} предупр., ${err} ошибок, ${intra} внутр.`;
    const badge = document.getElementById('bk3-fabbadge');
    badge.textContent = err > 0 ? err : '';
    badge.style.display = err > 0 ? 'flex' : 'none';
  }

  // ---- прогресс подтверждения по всей базе ----
  async function showProgress() {
    const prog = document.getElementById('bk3-progress');
    prog.textContent = 'Загрузка всех записей…';
    try {
      const rows = await fetchAllRows();
      const total = rows.length;
      const done = rows.filter(r => r.is_check).length;
      const byRju = {};
      rows.forEach(r => {
        const k = r.sendRjuId;
        byRju[k] = byRju[k] || { t: 0, d: 0 };
        byRju[k].t++; if (r.is_check) byRju[k].d++;
      });
      const parts = Object.keys(byRju).sort().map(k =>
        `${RJU_NAME[k] || k}: ${byRju[k].d}/${byRju[k].t}`);
      const newIds = KNOWN_IDS ? rows.filter(r => !KNOWN_IDS.has(r.id)).length : 0;
      saveKnown(rows.map(r => r.id));
      prog.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = `Подтверждено ${done} из ${total} (${(100 * done / total).toFixed(1)}%). `;
      prog.appendChild(b);
      prog.append(parts.join(' · '));
      if (newIds) prog.append(` · Новых записей с прошлой сверки: ${newIds}`);
      prog.append(' · База «известных» записей обновлена.');
    } catch (e) {
      prog.textContent = 'Ошибка: ' + e.message;
    }
  }

  // ---- выгрузка всех ошибок в Excel (CSV, все 9769 записей через штатный API сайта) ----
  const RJU_NAME = { 1: 'Ташкентский', 2: 'Кокандский', 3: 'Бухарский', 4: 'Кунградский', 5: 'Каршинский', 6: 'Термезский' };

  async function fetchAllRows() {
    const cols = ['id', 'sendstranacode', 'sendStationBegin', 'sendStationEnd', 'sendRjuId',
                  'receivestranacode', 'receiveStationBegin', 'receiveStationEnd', 'punktsConcat', '', ''];
    const p = new URLSearchParams();
    p.set('draw', '99');
    cols.forEach((c, i) => {
      p.set(`columns[${i}][data]`, c); p.set(`columns[${i}][name]`, '');
      p.set(`columns[${i}][searchable]`, 'true'); p.set(`columns[${i}][orderable]`, i === 0 ? 'true' : 'false');
      p.set(`columns[${i}][search][value]`, ''); p.set(`columns[${i}][search][regex]`, 'false');
    });
    p.set('order[0][column]', '0'); p.set('order[0][dir]', 'asc');
    p.set('start', '0'); p.set('length', '20000');
    p.set('search[value]', ''); p.set('search[regex]', 'false');
    const rju = document.getElementById('rjuFilter');
    p.set('rjuId', (rju && rju.value) || '0');
    const r = await fetch('/ed/Marshurt/ListPlanExport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: p.toString(),
    });
    return (await r.json()).data;
  }

  const ST_RU = { ERR: 'ОШИБКА', BAD: 'ГРУБАЯ ОШИБКА', WARN: 'Предупреждение', NOTE: 'По примечанию', APPR: 'Согласовано', INTRA: 'Внутренний' };

  async function exportErrorsCsv() {
    const prog = document.getElementById('bk3-progress');
    prog.textContent = 'Загрузка всех записей…';
    try {
      const rows = await fetchAllRows();
      saveKnown(rows.map(r => r.id));
      loadApprovals();
      prog.textContent = `Проверка ${rows.length} записей…`;
      const out = [['ID', 'Статус', 'Узел', 'Отправление', 'Код дороги', 'Приём', 'Пункты на сайте', 'По книге', 'Причина']];
      rows.forEach(r => {
        const v = validate({
          sendBegin: r.sendStationBegin, sendEnd: r.sendStationEnd,
          rju: String(r.sendRjuId), recvStrana: r.receiveStranaCode,
          recvBegin: r.receiveStationBegin, recvEnd: r.receiveStationEnd,
          punkts: r.punktsConcat || '',
        });
        if (v.st === 'OK') return;
        out.push([
          r.id, ST_RU[v.st] || v.st, RJU_NAME[r.sendRjuId] || r.sendRjuId,
          `${r.sendStationBegin}-${r.sendStationEnd}`, r.receiveStranaCode,
          `${r.receiveStationBegin}-${r.receiveStationEnd}`,
          (r.punktsConcat || '').replace(/\s+/g, ' '),
          v.rule ? chainStr(v.rule.ch) : '', v.msg,
        ]);
      });
      const csv = '﻿' + out.map(row =>
        row.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'oshibki_kniga3_' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
      URL.revokeObjectURL(a.href);
      prog.textContent = `Готово: выгружено ${out.length - 1} проблемных записей из ${rows.length}.`;
    } catch (e) {
      prog.textContent = 'Ошибка выгрузки: ' + e.message;
    }
  }

  // Faqat OK (kitobga to'liq mos) qatorlarda saytning O'Z tasdiqlash tugmasini bosadi.
  function approveVisibleOK() {
    const btns = [];
    document.querySelectorAll('#table1 tbody tr[data-bk3="OK"] .plan-export-check-btn').forEach(b => btns.push(b));
    const prog = document.getElementById('bk3-progress');
    if (!btns.length) { prog.textContent = 'Неподтверждённых соответствующих строк нет.'; return; }
    if (!confirm(`Подтвердить ${btns.length} строк, соответствующих книге?`)) return;
    let i = 0;
    (function next() {
      if (i >= btns.length) { prog.textContent = `Готово: подтверждено ${btns.length}.`; return; }
      prog.textContent = `Подтверждение: ${i + 1}/${btns.length}…`;
      btns[i].click();
      i++;
      setTimeout(next, 700); // ponytail: serverni bosmaslik uchun oddiy pauza
    })();
  }

  // ---- EditPlanExport: kitob bo'yicha yordamchi panel ----
  function findPunktTable() {
    return Array.from(document.querySelectorAll('table')).find(t => {
      const ths = Array.from(t.querySelectorAll('thead th')).map(x => x.textContent.trim());
      return ths.some(h => h.includes('Станция')) && ths.some(h => h.includes('№'));
    });
  }

  function readEditForm() {
    const val = n => { const el = document.querySelector(`select[name="${n}"], #${n}`); return el ? String(el.value || '').trim() : ''; };
    const pt = findPunktTable();
    const punkts = [];
    if (pt) pt.querySelectorAll('tbody tr').forEach(tr => {
      const td = tr.querySelectorAll('td');
      if (td.length >= 3) {
        const n = parseInt(td[0].textContent.trim(), 10);
        const code = td[2].textContent.trim();
        if (!isNaN(n) && /^\d{5,6}$/.test(code)) punkts.push(`${n}-${code}`);
      }
    });
    return {
      sendBegin: val('SendStationBegin'), sendEnd: val('SendStationEnd'),
      rju: val('SendRjuId'), recvStrana: val('ReceiveStranaCode'),
      recvBegin: val('ReceiveStationBegin'), recvEnd: val('ReceiveStationEnd'),
      punkts: punkts.join(', '),
    };
  }

  function renderEditAssist() {
    const row = readEditForm();
    let p = document.getElementById('bk3-edit');
    if (!p) {
      p = document.createElement('div');
      p.id = 'bk3-edit';
      p.innerHTML = `<div id="bk3-head" title="Перетащите, чтобы переместить">
          <span class="bk3-grip">⠿</span><b>Книга 3: подсказка</b>
          <button id="bk3-emin" type="button" title="Свернуть">—</button>
        </div><div id="bk3-ebody"></div>`;
      document.body.appendChild(p);
      makeDraggable(p, p.querySelector('#bk3-head'), 'bk3_epos', { dragged: false });
      restorePos(p, 'bk3_epos');
      p.querySelector('#bk3-emin').addEventListener('click', () => {
        const b = p.querySelector('#bk3-ebody');
        const hidden = b.style.display === 'none';
        b.style.display = hidden ? 'block' : 'none';
        p.querySelector('#bk3-emin').textContent = hidden ? '—' : '+';
      });
    }
    const body = p.querySelector('#bk3-ebody');
    if (!row.sendBegin || !row.recvBegin) {
      body.textContent = 'Заполните диапазоны отправления и приёма — подсказка появится автоматически.';
      return;
    }
    loadApprovals();
    const v = validate(row);
    const actual = v.actual || [];
    // № ustuni saytda har doim zanjir tartibini anglatmaydi — to'plam bo'yicha solishtiramiz
    let stCls = CLS[v.st] || 'bk3-err';
    let stMsg = ({ OK: '✓ ', WARN: '△ ', NOTE: '◆ ', APPR: '◉ ', INTRA: '· ' }[v.st] || '✗ ') + v.msg;
    if (v.st === 'ERR' && v.rule &&
        actual.length === v.rule.ch.length && v.rule.ch.every(c => actual.includes(c))) {
      stCls = 'bk3-warn';
      stMsg = '△ Все пункты книги присутствуют — сверьте только нумерацию (№): порядок по книге указан ниже';
    }
    body.innerHTML = '';
    const st = document.createElement('div');
    st.className = 'bk3-est bk3-est-' + stCls;
    st.textContent = stMsg;
    body.appendChild(st);
    if (v.rule && v.rule.ch.length) {
      const h = document.createElement('div');
      h.className = 'bk3-elabel';
      h.textContent = 'Цепочка по книге (' + v.rule.road.slice(0, 45) + '):';
      body.appendChild(h);
      const ol = document.createElement('ol');
      ol.className = 'bk3-echain';
      v.rule.ch.forEach((c, i) => {
        const li = document.createElement('li');
        li.textContent = nm(c);
        if (actual.includes(c)) { li.className = 'bk3-eok'; li.textContent += ' — есть'; }
        else { li.className = 'bk3-emiss'; li.textContent += ' — ДОБАВИТЬ (№ ' + (i + 1) + ')'; }
        ol.appendChild(li);
      });
      body.appendChild(ol);
      const extra = actual.filter(c => !v.rule.ch.includes(c));
      if (extra.length) {
        const d = document.createElement('div');
        d.className = 'bk3-emiss';
        d.textContent = 'Убрать лишние пункты: ' + extra.map(nm).join(', ');
        body.appendChild(d);
      }
    }
  }

  function initEdit() {
    renderEditAssist();
    const deb = () => { clearTimeout(window.__bk3e); window.__bk3e = setTimeout(renderEditAssist, 250); };
    document.addEventListener('change', deb, true);
    const pt = findPunktTable();
    if (pt) new MutationObserver(deb).observe(pt, { childList: true, subtree: true });
    setInterval(deb, 2000); // ponytail: select2 ba'zan change bermaydi — sekin polling yetarli
  }

  function initList() {
    const target = document.getElementById('table1');
    if (target) new MutationObserver(() => {
      clearTimeout(window.__bk3t);
      window.__bk3t = setTimeout(processTable, 150);
    }).observe(target, { childList: true, subtree: true });
    processTable();
  }

  if (PATH.includes('/Marshurt/EditPlanExport')) initEdit();
  else initList();
})();
