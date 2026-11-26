'use strict';
// 株チェック（ひろき専用）。データは暗号化されていて、合言葉がないと読めない。
const REPO = 'Hiro-guitar/kabu-app';
const S = { data: null, key: null, salt: null, view: 'watch', day: null, live: {}, liveAt: null, watch: [], watchSha: null, years: {} };

// ---------- 小道具 ----------
const LS = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
const svg = (tag, a) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
const safeUrl = (u) => (/^https?:\/\//.test(u || '') ? u : null);
const link = (u, t) => { const s = safeUrl(u); return s ? h('a', { href: s, target: '_blank', rel: 'noopener' }, t) : h('span', null, t); };
const md = (d) => { const p = String(d || '').split('-'); return p.length === 3 ? `${+p[1]}/${+p[2]}` : String(d || ''); };
const ymd = (d) => { const p = String(d || '').split('-'); return p.length === 3 ? `${p[0]}年${+p[1]}月${+p[2]}日` : String(d || ''); };
const pct = (v) => (v == null || isNaN(v) ? '' : `${v > 0 ? '+' : ''}${(+v).toFixed(1)}%`);
const tagCls = (t) => (t === '放置' ? 'p-houchi' : t === '動き出し' ? 'p-ugoki' : t === '下落中' ? 'p-geraku' : 'p-sonota');
const todayJ = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ---------- 暗号 ----------
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function b64e(u) { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function unseal(box, key) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(box.iv) }, key, b64d(box.ct));
  const st = new Blob([pt]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(st).text());
}
async function seal(obj, key, saltB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const st = new Blob([new TextEncoder().encode(JSON.stringify(obj))]).stream().pipeThrough(new CompressionStream('gzip'));
  const gz = new Uint8Array(await new Response(st).arrayBuffer());
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, gz));
  return { v: 1, salt: saltB64, iv: b64e(iv), ct: b64e(ct) };
}
async function getJSON(path) {
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

// ---------- 起動と合言葉 ----------
async function boot() {
  const saved = LS.get('kabu_key');
  if (saved) {
    try {
      S.key = await crypto.subtle.importKey('raw', b64d(saved), 'AES-GCM', true, ['encrypt', 'decrypt']);
      S.salt = LS.get('kabu_salt');
      await loadData();
      return;
    } catch (e) {
      LS.del('kabu_key');
    }
  }
  lockScreen();
}
function lockScreen(msg) {
  $('#tabs').hidden = true; $('.top').hidden = true;
  const inp = h('input', { type: 'password', autocomplete: 'current-password', placeholder: '合言葉' });
  const m = h('p', { class: 'msg ng', hidden: !msg }, msg || '');
  const go = h('button', { class: 'btn pri', type: 'button' }, '開く');
  const run = async () => {
    go.disabled = true; m.hidden = true;
    try {
      let chk;
      try { chk = await getJSON('check.bin'); } catch (e) { m.textContent = 'まだデータが届いていません。毎日のチェックが一度終わると開けるようになります。'; m.hidden = false; go.disabled = false; return; }
      const key = await deriveKey(inp.value, b64d(chk.salt));
      const ok = await unseal(chk, key);
      if (ok.ok !== 'kabu-app') throw new Error();
      S.key = key; S.salt = chk.salt;
      LS.set('kabu_key', b64e(new Uint8Array(await crypto.subtle.exportKey('raw', key))));
      LS.set('kabu_salt', chk.salt);
      $('#tabs').hidden = false; $('.top').hidden = false;
      await loadData();
    } catch (e) {
      m.textContent = '合言葉が違うか、データを読めませんでした。'; m.hidden = false; go.disabled = false;
    }
  };
  go.addEventListener('click', run);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  $('#main').replaceChildren(h('div', { class: 'lock' },
    h('img', { src: 'icon-180.png', alt: '' }), h('h1', null, '株チェック'),
    h('p', { class: 'note' }, '合言葉を入れてください。この端末が覚えるので、次からは入れなくて大丈夫です。'),
    inp, go, m));
}
async function loadData() {
  $('#main').replaceChildren(h('p', { class: 'empty' }, '読み込んでいます…'));
  try {
    const box = await getJSON('data.bin');
    if (box.salt !== S.salt) { LS.del('kabu_key'); return lockScreen('合言葉が変わったようです。もう一度入れてください。'); }
    S.data = await unseal(box, S.key);
  } catch (e) {
    $('#main').replaceChildren(h('p', { class: 'empty' }, 'データを読めませんでした。電波のよいところで開き直してください。'));
    return;
  }
  await loadWatch();
  S.day = S.data.summary[0] ? S.data.summary[0].day || S.data.summary[0].date : null;
  $('#built').textContent = S.data.built_at ? `${md(S.data.built_at.slice(0, 10))} ${S.data.built_at.slice(11, 16)} のチェック` : '—';
  render();
  refreshLive();
}

// ---------- 見守り（watch.bin を GitHub に保存） ----------
async function loadWatch() {
  const tok = LS.get('kabu_gh');
  try {
    if (tok) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/watch.bin?t=${Date.now()}`, { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (r.status === 404) { S.watch = []; S.watchSha = null; return; }
      const j = await r.json(); S.watchSha = j.sha;
      S.watch = await unseal(JSON.parse(new TextDecoder().decode(b64d(j.content.replace(/\n/g, '')))), S.key);
    } else {
      S.watch = await unseal(await getJSON('watch.bin'), S.key);
    }
  } catch (e) {
    S.watch = (S.data && S.data.watch || []).map((w) => ({ code: w.code, name: w.name, added_at: w.added_at, added_price: w.added_price, memo: w.memo || '' }));
  }
}
async function saveWatch(next) {
  const tok = LS.get('kabu_gh');
  if (!tok) { alertBox('「見守る」を使うには、設定で GitHub の書き込み用トークンを入れてください。'); openSettings(); return false; }
  try {
    const box = await seal(next, S.key, S.salt);
    const body = { message: 'watch', content: b64e(new TextEncoder().encode(JSON.stringify(box))) };
    if (S.watchSha) body.sha = S.watchSha;
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/watch.bin`, { method: 'PUT', headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json' }, body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) { await loadWatch(); return saveWatch(mergeWatch(next)); }
    if (!r.ok) throw new Error(r.status);
    const j = await r.json(); S.watchSha = j.content.sha; S.watch = next;
    return true;
  } catch (e) {
    alertBox('保存できませんでした。トークンが正しいか、電波があるかを確かめてください。');
    return false;
  }
}
function mergeWatch(next) { return next; }
const isWatched = (code) => S.watch.some((w) => String(w.code) === String(code));
async function toggleWatch(code, name, btn) {
  code = String(code);
  if (btn) btn.disabled = true;
  let next;
  if (isWatched(code)) next = S.watch.filter((w) => String(w.code) !== code);
  else next = [...S.watch, { code, name: name || nameOf(code), added_at: todayJ(), added_price: priceNow(code), memo: '' }];
  await saveWatch(next);
  if (btn) btn.disabled = false;
  render(); if (S.detail) openDetail(S.detail, true);
}
function watchBtn(code, name) {
  const on = isWatched(code);
  const b = h('button', { class: 'btn' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on) }, on ? '見守り中' : '見守る');
  b.addEventListener('click', (e) => { e.stopPropagation(); toggleWatch(code, name, b); });
  return b;
}

// ---------- 株価 ----------
function nameOf(code) {
  const d = S.data; code = String(code);
  const f = (a) => (a || []).find((r) => String(r.code) === code);
  const r = f(S.watch) || f(d.today) || f(d.history) || f(d.value) || f(d.drops) || f(d.exdates);
  return r ? r.name : code;
}
function lastClose(code) { const p = S.data.prices[String(code)]; return p && p.c.length ? p.c[p.c.length - 1] : null; }
function priceNow(code) { const l = S.live[String(code)]; return l && l.price != null ? l.price : lastClose(code); }
function symOf(code) { return `${code}.${(S.data.regional || {})[code] || 'T'}`; }
function liveCodes() {
  const set = new Set(S.watch.map((w) => String(w.code)));
  S.data.today.filter((r) => (r.day || r.date) === S.day).forEach((r) => set.add(String(r.code)));
  if (S.detail) set.add(String(S.detail));
  return [...set];
}
async function refreshLive() {
  const url = LS.get('kabu_gas');
  const note = $('#live-note');
  if (!url) { note.hidden = false; note.textContent = '表示は前の晩のチェック時点の株価です（設定で株価の取り次ぎ先を入れると、開いた時点の株価になります）。'; return; }
  const codes = liveCodes(); if (!codes.length) return;
  const b = $('#btn-live'); b.classList.add('spin');
  try {
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}s=${encodeURIComponent(codes.map(symOf).join(','))}`);
    const j = await r.json();
    for (const [sym, v] of Object.entries(j.quotes || {})) if (v && v.price != null) S.live[sym.split('.')[0]] = v;
    S.liveAt = new Date();
    note.hidden = false;
    const ts = Math.max(0, ...Object.values(S.live).map((v) => +v.time || 0));
    const qt = ts ? new Date(ts * 1000) : null;
    const hm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    note.textContent = `${hm(S.liveAt)} に取得。株価は ${qt ? hm(qt) + ' 時点' : '時刻不明'} の値です（Yahoo Finance。証券会社の画面より遅れることがあります）`;
    render(); if (S.detail) openDetail(S.detail, true);
  } catch (e) {
    note.hidden = false; note.textContent = '今の株価を取れませんでした。前の晩のチェック時点の株価を出しています。';
  } finally { b.classList.remove('spin'); }
}
function priceBox(code, small) {
  const l = S.live[String(code)];
  const p = l && l.price != null ? l.price : lastClose(code);
  if (p == null) return h('div', { class: 'price' }, h('small', null, '株価なし'));
  const prev = l && l.prev != null ? l.prev : null;
  const chg = prev ? (p / prev - 1) * 100 : null;
  return h('div', { class: 'price' }, h('b', { class: chg > 0 ? 'up' : chg < 0 ? 'dn' : '' }, `${p}円`),
    h('small', null, l ? `前日比 ${pct(chg)}` : '前の晩の終値'));
}

// ---------- 画面 ----------
function setView(v) { S.view = v; document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.v === v ? 'page' : 'false')); render(); window.scrollTo(0, 0); }
function render() {
  if (!S.data) return;
  const m = $('#main');
  const f = { watch: vWatch, cand: vCand, value: vValue, drops: vDrops, hist: vHist }[S.view] || vWatch;
  m.replaceChildren(...[].concat(f()));
}
function dayChips() {
  const days = [...new Set(S.data.summary.map((r) => r.day || r.date))];
  return h('div', { class: 'chips' }, days.map((d, i) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(d === S.day) }, i === 0 ? `${md(d)}（最新）` : md(d));
    b.addEventListener('click', () => { S.day = d; render(); refreshLive(); });
    return b;
  }));
}
const onDay = (rows) => (rows || []).filter((r) => (r.day || r.date) === S.day);

function vWatch() {
  const out = [h('h2', null, '見守り中の銘柄'), h('p', { class: 'note' }, '「見守る」で入れた銘柄。毎晩のチェックで追いかけます。')];
  if (!S.watch.length) { out.push(h('div', { class: 'empty' }, 'まだありません。「候補」や「記録」から「見守る」を押すと入ります。')); return out; }
  const ev = S.data.watch_events || [];
  const list = h('div', { class: 'list' });
  [...S.watch].sort((a, b) => String(b.added_at).localeCompare(String(a.added_at))).forEach((w) => {
    const code = String(w.code); const p = priceNow(code); const ap = w.added_price != null ? +w.added_price : null;
    const chg = p != null && ap ? (p / ap - 1) * 100 : null;
    const mine = ev.filter((e) => String(e.code) === code);
    const card = h('div', { class: 'card tap', onclick: () => openDetail(code) },
      h('div', { class: 'row' }, h('span', { class: 'name' }, w.name || code), h('span', { class: 'code' }, code),
        h('div', { class: 'price' }, h('b', { class: chg > 0 ? 'up' : chg < 0 ? 'dn' : '' }, p != null ? `${p}円` : '—'),
          h('small', null, ap ? `入れた日 ${ap}円から ${pct(chg)}` : `${md(w.added_at)}に入れた`))),
      h('div', { class: 'ev' }, mine.length ? [h('b', null, `${md(mine[0].date)} ${mine[0].kind}`), `：${mine[0].what}`] : `${md(w.added_at)}に入れた／まだ何も起きていません`));
    list.append(card);
  });
  out.push(list);
  return out;
}
function vCand() {
  const sm = S.data.summary.find((r) => (r.day || r.date) === S.day) || {};
  const out = [dayChips(),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', null, '候補'), h('b', null, sm.candidates ?? '—')),
      h('div', { class: 'stat' }, h('span', null, '危険信号'), h('b', null, sm.signals ?? '—')),
      h('div', { class: 'stat' }, h('span', null, '開示'), h('b', null, sm.disclosures ?? '—')),
      h('div', { class: 'stat' }, h('span', null, 'IR'), h('b', null, sm.ir_companies ?? '—')))];
  const rows = onDay(S.data.today);
  out.push(h('h2', null, `${ymd(S.day)}の候補`));
  if (!rows.length) out.push(h('div', { class: 'empty' }, 'この日の候補はありません。'));
  rows.forEach((r) => out.push(candCard(r)));
  const sig = onDay(S.data.signals);
  if (sig.length) {
    out.push(h('h2', null, '危険信号'));
    out.push(h('div', { class: 'list' }, sig.map((s) => h('div', { class: 'li sig', onclick: () => openDetail(s.code) },
      h('div', { class: 'row' }, h('span', { class: 'name' }, s.name), h('span', { class: 'code' }, s.code), s.tag ? h('span', { class: 'pill ' + tagCls(s.tag) }, s.tag) : null),
      h('p', null, s.what)))));
  }
  if (sm.data_note) out.push(h('p', { class: 'note' }, sm.data_note));
  return out;
}
function candCard(r) {
  const v = (S.data.value || []).find((x) => String(x.code) === String(r.code));
  return h('div', { class: 'card tap', onclick: () => openDetail(r.code) },
    h('div', { class: 'row' }, h('span', { class: 'name' }, r.name), h('span', { class: 'code' }, r.code),
      h('span', { class: 'pill ' + tagCls(r.tag) }, r.tag), v ? h('span', { class: 'pill p-acc' }, `中身で安い${v.level === '3つとも' ? '（3つとも）' : ''}`) : null, priceBox(r.code)),
    h('dl', { class: 'kv' },
      h('dt', null, '伸びている'), h('dd', null, r.growth || '—'),
      h('dt', null, '放置の理由'), h('dd', null, r.why || '—'),
      h('dt', null, '気になる点'), h('dd', null, r.risk || '—'),
      h('dt', null, '出どころ'), h('dd', { onclick: (e) => e.stopPropagation() }, link(r.source_url, r.source_title || '資料'))),
    h('div', { class: 'btns' }, watchBtn(r.code, r.name), h('button', { class: 'btn', type: 'button' }, 'チャートと開示')));
}
function vValue() {
  const rows = S.data.value || [];
  return [h('h2', null, '中身に比べて安い会社'),
    h('p', { class: 'note' }, '会社全体の値段が、今期の予想利益の何年分か・手元の現金の何倍か・財産（純資産）の何倍か。過去の検証では、3つともの会社は1年後に市場全体に勝つ割合が高く、大負けが少なめでした。短期で大きく取るより、負けにくくする物差しです。'),
    rows.length ? h('div', { class: 'list' }, rows.map((r) => h('div', { class: 'li', onclick: () => openDetail(r.code) },
      h('div', { class: 'row' }, h('span', { class: 'name' }, r.name), h('span', { class: 'code' }, r.code),
        h('span', { class: 'pill ' + (r.level === '3つとも' ? 'p-acc' : 'p-sonota') }, r.level), r.tag ? h('span', { class: 'pill ' + tagCls(r.tag) }, r.tag) : null,
        h('span', { class: 'price' }, h('b', { style: 'font-size:15px' }, `${r.price}円`))),
      h('p', null, `予想利益の${r.years ?? '—'}年分／現金の${r.cash_x ?? '—'}倍／財産の${r.assets_x ?? '—'}倍`)))) : h('div', { class: 'empty' }, '当てはまる会社はありません。')];
}
function vDrops() {
  const out = [dayChips(), h('h2', null, '大きく下げた銘柄と理由'),
    h('p', { class: 'note' }, '前の営業日から5%以上下げたもの。理由が「権利落ち」「市場全体」なら、事業の悪い話ではないかもしれません。')];
  const d = onDay(S.data.drops);
  out.push(d.length ? h('div', { class: 'list' }, d.slice(0, 30).map((r) => h('div', { class: 'li ' + (r.reason_kind === '不明' || r.reason_kind === '開示あり' || r.reason_kind === '大株主の売却' ? 'sig' : ''), onclick: () => openDetail(r.code) },
    h('div', { class: 'row' }, h('span', { class: 'name' }, r.name), h('span', { class: 'code' }, r.code), h('span', { class: 'pill p-sonota' }, r.reason_kind),
      h('span', { class: 'price' }, h('b', { class: 'dn', style: 'font-size:15px' }, `${r.ret}%`), h('small', null, `${r.prev}→${r.close}円`))),
    h('p', null, r.reason + (r.titles ? `（${r.titles}）` : ''))))) : h('div', { class: 'empty' }, 'この日は5%以上下げた銘柄はありません。'));
  out.push(h('h2', null, '近い権利付最終日（2週間以内）'));
  const ex = S.data.exdates || [];
  out.push(ex.length ? h('div', { class: 'list' }, ex.map((r) => h('div', { class: 'li warnl', onclick: () => openDetail(r.code) },
    h('div', { class: 'row' }, h('span', { class: 'name' }, r.name), h('span', { class: 'code' }, r.code), r.tag ? h('span', { class: 'pill ' + tagCls(r.tag) }, r.tag) : null),
    h('p', null, `${r.kind}：権利付最終日 ${md(r.last_day)}（あと${r.days}日）／権利落ち日 ${md(r.ex_day)}／株価${r.price}円`),
    r.past_note ? h('p', null, r.past_note) : null))) : h('div', { class: 'empty' }, '2週間以内に権利付最終日が来る銘柄はありません。'));
  return out;
}
function vHist() {
  const rows = [...(S.data.history || [])].reverse();
  return [h('h2', null, 'これまでの記録'), h('p', { class: 'note' }, '見送った銘柄も含めて全部残しています。3か月・6か月後に答え合わせします。'),
    h('div', { class: 'list' }, rows.map((r) => h('div', { class: 'li', onclick: () => openDetail(r.code) },
      h('div', { class: 'row' }, h('span', { class: 'code' }, md(r.date)), h('span', { class: 'name', style: 'font-size:15px' }, r.name), h('span', { class: 'code' }, r.code),
        h('span', { class: 'price' }, watchBtn(r.code, r.name))),
      h('p', null, `${r.price ? r.price + '円・' : ''}${r.judgement || ''}`))))];
}

// ---------- 詳細（チャート・開示・見守りのできごと） ----------
function openDetail(code, keep) {
  code = String(code); S.detail = code;
  const sh = $('#sheet'); const y0 = keep ? sh.scrollTop : 0;
  const name = nameOf(code);
  const l = S.live[code]; const p = priceNow(code); const chg = l && l.prev ? (l.price / l.prev - 1) * 100 : null;
  const cand = [...(S.data.today || [])].reverse().find((r) => String(r.code) === code);
  const w = S.watch.find((x) => String(x.code) === code);
  const body = h('div', { class: 'sheet-body' });
  body.append(h('div', { class: 'big' }, h('b', { class: chg > 0 ? 'up' : chg < 0 ? 'dn' : '' }, p != null ? `${p}円` : '—'),
    h('span', null, l ? `前日比 ${pct(chg)}（${S.liveAt ? `${S.liveAt.getHours()}:${String(S.liveAt.getMinutes()).padStart(2, '0')}取得` : ''}）` : '前の晩の終値'),
    (S.data.tags || {})[code] ? h('span', { class: 'pill ' + tagCls(S.data.tags[code]) }, S.data.tags[code]) : null));
  body.append(h('div', { class: 'btns' }, watchBtn(code, name)));
  // チャート
  const sec = h('div', { class: 'sec' });
  const bar = h('div', { class: 'chips' }); const box = h('div', { class: 'chart' });
  [[0.5, '半年'], [1, '1年'], [2, '2年'], [5, '5年（週足）']].forEach(([n, t]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String((S.years[code] || 1) === n) }, t);
    b.addEventListener('click', () => { S.years[code] = n; bar.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawChart(box, code, n); });
    bar.append(b);
  });
  sec.append(h('h3', null, '日足（赤＝上げた日、青＝下げた日。指で横になぞるとその日。下の三角＝開示・お知らせの日）'), bar, box);
  body.append(sec);
  if (w) {
    const ev = (S.data.watch_events || []).filter((e) => String(e.code) === code);
    const s2 = h('div', { class: 'sec' }, h('h3', null, `見守りに入れてからのできごと（${md(w.added_at)}〜${w.added_price ? `、入れた日の株価 ${w.added_price}円` : ''}）`));
    s2.append(ev.length ? h('ul', { class: 'news' }, ev.slice(0, 40).map((e) => h('li', null, h('span', { class: 'd' }, md(e.date)), h('span', { class: 'pill ' + (e.kind === '下げ' || e.kind === '大株主' ? 'p-geraku' : e.kind === '開示' ? 'p-ugoki' : 'p-sonota') }, e.kind), link(e.url, e.what))))
      : h('p', { class: 'note' }, 'まだ何も起きていません（毎晩のチェックで記録します）。'));
    const ta = h('textarea', { rows: 2 }); ta.value = w.memo || '';
    const ok = h('p', { class: 'msg ok', hidden: true }, '保存しました。');
    const sv = h('button', { class: 'btn', type: 'button' }, 'メモを保存');
    sv.addEventListener('click', async () => { sv.disabled = true; const next = S.watch.map((x) => (String(x.code) === code ? { ...x, memo: ta.value.trim() } : x)); ok.hidden = !(await saveWatch(next)); sv.disabled = false; });
    s2.append(h('label', { class: 'f' }, 'メモ（入れた理由など）', ta), h('div', { class: 'btns' }, sv, ok));
    body.append(s2);
  }
  if (cand) body.append(h('div', { class: 'sec' }, h('h3', null, `候補にしたとき（${md(cand.day || cand.date)}）`),
    h('dl', { class: 'kv' }, h('dt', null, '伸びている'), h('dd', null, cand.growth || '—'), h('dt', null, '放置の理由'), h('dd', null, cand.why || '—'),
      h('dt', null, '気になる点'), h('dd', null, cand.risk || '—'), h('dt', null, '出どころ'), h('dd', null, link(cand.source_url, cand.source_title || '資料')))));
  const ns = (S.data.news || []).filter((x) => String(x.code) === code);
  if (ns.length) {
    const s3 = h('div', { class: 'sec' }, h('h3', null, '最近の開示・お知らせ（直近1年。日付を押すとチャートでその日を選びます）'));
    const item = (x) => {
      const d = h('button', { class: 'd', type: 'button' }, x.date.slice(2).replaceAll('-', '/'));
      d.addEventListener('click', () => { if (box._select && box._select(x.date)) box.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
      const kc = x.kind === '危険' ? 'p-geraku' : x.kind === '業績修正' || x.kind === '決算' ? 'p-ugoki' : x.kind === '月次' ? 'p-houchi' : x.kind === '大株主' ? 'p-acc' : 'p-sonota';
      return h('li', null, d, h('span', { class: 'pill ' + kc }, x.kind), link(x.url, x.title));
    };
    const ul = h('ul', { class: 'news' }, ns.slice(0, 10).map(item)); s3.append(ul);
    if (ns.length > 10) { const more = h('button', { class: 'btn', type: 'button' }, `もっと見る（${ns.length - 10}件）`); more.addEventListener('click', () => { ns.slice(10).forEach((x) => ul.append(item(x))); more.remove(); }); s3.append(more); }
    body.append(s3);
  }
  const back = h('button', { class: 'ibtn', type: 'button', 'aria-label': '戻る' }, '‹');
  back.style.fontSize = '24px';
  back.addEventListener('click', closeDetail);
  sh.replaceChildren(h('div', { class: 'sheet-top' }, back, h('h2', null, `${name}（${code}）`)), body);
  sh.hidden = false; document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => { drawChart(box, code, S.years[code] || 1); sh.scrollTop = y0; });
  if (!keep && LS.get('kabu_gas') && !S.live[code]) refreshLive();
}
function closeDetail() { S.detail = null; $('#sheet').hidden = true; document.body.style.overflow = ''; }

// ---------- ローソク足チャート ----------
function niceTicks(lo, hi, n) {
  const span = hi - lo || 1; const raw = span / n; const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const t = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(6));
  return { t, lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step };
}
function drawChart(host, code, yrs) {
  host.replaceChildren();
  const P = S.data.prices[String(code)];
  if (!P || P.d.length < 2) { host.append(h('p', { class: 'note' }, 'この銘柄の株価データはまだありません（候補か見守りに入ると、次の晩から入ります）。')); return; }
  let pts = P.d.map((d, i) => ({ d, o: P.o[i], h: P.h[i], l: P.l[i], c: P.c[i], v: P.v[i] }));
  const last = new Date(pts[pts.length - 1].d); const from = new Date(last.getTime() - yrs * 365.25 * 864e5).toISOString().slice(0, 10);
  pts = pts.filter((p) => p.d >= from);
  const weekly = yrs >= 5;
  if (weekly) {
    const g = new Map();
    pts.forEach((p) => { const t = new Date(p.d + 'T00:00:00Z'); const k = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); if (!g.has(k)) g.set(k, []); g.get(k).push(p); });
    pts = [...g.entries()].map(([k, a]) => ({ d: k, o: a[0].o, c: a[a.length - 1].c, h: Math.max(...a.map((x) => x.h)), l: Math.min(...a.map((x) => x.l)), v: a.reduce((s, x) => s + x.v, 0) }));
  }
  const W = Math.max(280, host.clientWidth || 320), H = 250, VH = 48, mt = 10, mb = 22;
  const lo = Math.min(...pts.map((p) => p.l)), hi = Math.max(...pts.map((p) => p.h)), pad = (hi - lo) * 0.06 || 1;
  const nt = niceTicks(lo - pad, hi + pad, 5);
  const AW = Math.max(...nt.t.map((t) => String(t).length)) * 6.4 + 18;
  const y = (v) => mt + (nt.hi - v) / (nt.hi - nt.lo) * (H - mt - mb);
  const n = pts.length, step = (W - AW - 4) / n, bw = Math.max(0.8, step * (n > 150 ? 0.7 : 0.62));
  const x = (i) => AW + step * (i + 0.5);
  const vmax = Math.max(...pts.map((p) => p.v)) || 1; const yv = (v) => H + VH - (v / vmax) * (VH - 16);
  const sv = svg('svg', { viewBox: `0 0 ${W} ${H + VH}`, role: 'img', 'aria-label': `直近の株価。安値${lo}円、高値${hi}円` });
  nt.t.forEach((t) => {
    sv.append(svg('line', { x1: AW, x2: W - 4, y1: y(t), y2: y(t), stroke: '#2a3542', 'stroke-width': 1 }));
    const tx = svg('text', { class: 'ax', x: AW - 6, y: y(t) + 3.5, 'text-anchor': 'end' }); tx.textContent = `${t}円`; sv.append(tx);
  });
  const vt = svg('text', { class: 'ax', x: AW - 6, y: H + VH - 2, 'text-anchor': 'end' }); vt.textContent = '出来高'; sv.append(vt);
  const gap = yrs >= 5 ? 12 : yrs >= 2 ? 3 : yrs >= 1 ? 2 : 1; let lastLab = -999;
  pts.forEach((p, i) => {
    const m = +p.d.slice(5, 7); if (i > 0 && p.d.slice(0, 7) === pts[i - 1].d.slice(0, 7)) return;
    if (i > 0 && (m - 1) % gap !== 0) return; if (x(i) - lastLab < 48) return; lastLab = x(i);
    sv.append(svg('line', { x1: x(i) - step / 2, x2: x(i) - step / 2, y1: mt, y2: H + VH, stroke: '#2a3542', 'stroke-width': 1 }));
    const t = svg('text', { class: 'ax', x: x(i) - step / 2 + 3, y: H - mb + 15 }); t.textContent = (i === 0 || m === 1 || gap >= 12) ? `${p.d.slice(2, 4)}年${m}月` : `${m}月`; sv.append(t);
  });
  pts.forEach((p, i) => sv.append(svg('rect', { x: x(i) - bw / 2, width: bw, y: yv(p.v), height: H + VH - yv(p.v), fill: '#34404e' })));
  pts.forEach((p, i) => {
    const col = p.c >= p.o ? '#e0524a' : '#3d82d6';
    sv.append(svg('line', { x1: x(i), x2: x(i), y1: y(p.h), y2: y(p.l), stroke: col, 'stroke-width': Math.min(1.2, bw) }));
    sv.append(svg('rect', { x: x(i) - bw / 2, width: bw, y: y(Math.max(p.o, p.c)), height: Math.max(1, Math.abs(y(p.o) - y(p.c))), fill: col }));
  });
  // 開示・お知らせの日
  const ns = (S.data.news || []).filter((e) => String(e.code) === String(code));
  const idxOf = (ds) => { let i = pts.findIndex((p) => p.d >= ds); if (weekly) { i = pts.findIndex((p, j) => p.d <= ds && (j === n - 1 || pts[j + 1].d > ds)); } if (i < 0) return -1; return (new Date(pts[i].d) - new Date(ds)) < 10 * 864e5 ? i : -1; };
  const byIdx = new Map(); ns.forEach((e) => { const i = idxOf(e.date); if (i >= 0) { if (!byIdx.has(i)) byIdx.set(i, []); byIdx.get(i).push(e); } });
  const kcol = (k) => (k === '危険' ? '#e0524a' : k === '業績修正' || k === '決算' ? '#e0a33a' : k === '月次' ? '#4fb37a' : k === '大株主' ? '#f2c14e' : '#8d9aa8');
  byIdx.forEach((a, i) => { const k = a.map((e) => e.kind).sort((p, q) => ['危険', '大株主', '業績修正', '決算', '月次'].indexOf(q) - ['危険', '大株主', '業績修正', '決算', '月次'].indexOf(p))[0];
    sv.append(svg('path', { d: `M${x(i)},${H + 3} l5,8 h-10 z`, fill: kcol(k) })); });
  const cross = svg('line', { y1: mt, y2: H + VH, stroke: '#e8edf2', 'stroke-opacity': 0.55, 'stroke-width': 1 }); sv.append(cross);
  const unit = weekly ? '週' : '日';
  const prev = h('button', { class: 'btn', type: 'button' }, `‹ 前の${unit}`), next = h('button', { class: 'btn', type: 'button' }, `次の${unit} ›`);
  const txt = h('div'); const evBox = h('ul', { class: 'news' });
  let sel = n - 1;
  const show = (i) => {
    sel = Math.max(0, Math.min(n - 1, i)); const p = pts[sel];
    cross.setAttribute('x1', x(sel)); cross.setAttribute('x2', x(sel));
    const pc = sel > 0 ? pts[sel - 1].c : null; const c = pc ? (p.c / pc - 1) * 100 : null;
    txt.replaceChildren(h('b', null, weekly ? `${ymd(p.d)}の週` : ymd(p.d)), `　終値 ${p.c}円${c != null ? `（前${unit}比 ${pct(c)}）` : ''}`,
      h('br'), h('small', null, `始値 ${p.o}／高値 ${p.h}／安値 ${p.l}／出来高 ${p.v.toLocaleString()}株`));
    prev.disabled = sel === 0; next.disabled = sel === n - 1;
    evBox.replaceChildren(...(byIdx.get(sel) || []).map((e) => h('li', null, h('span', { class: 'pill ' + (e.kind === '危険' ? 'p-geraku' : 'p-sonota') }, e.kind), link(e.url, e.title))));
  };
  prev.addEventListener('click', () => show(sel - 1)); next.addEventListener('click', () => show(sel + 1));
  let down = false;
  const pick = (ev) => { const r = sv.getBoundingClientRect(); const mx = (ev.clientX - r.left) * (W / r.width); show(Math.floor((mx - AW) / step)); };
  sv.addEventListener('pointerdown', (e) => { down = true; pick(e); });
  sv.addEventListener('pointermove', (e) => { if (down || e.pointerType === 'mouse') pick(e); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => sv.addEventListener(t, () => { down = false; }));
  host.append(sv, h('div', { class: 'cinfo' }, prev, txt, next), evBox);
  show(sel);
  host._select = (ds) => { const i = idxOf(ds); if (i >= 0) { show(i); return true; } return false; };
}

// ---------- 設定 ----------
function alertBox(t) { const n = $('#live-note'); n.hidden = false; n.textContent = t; }
function openSettings() {
  const gh = h('input', { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' }); gh.value = LS.get('kabu_gh') || '';
  const gas = h('input', { type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec' }); gas.value = LS.get('kabu_gas') || '';
  const ok = h('p', { class: 'msg ok', hidden: true }, '保存しました。');
  const save = h('button', { class: 'btn pri', type: 'button' }, '保存');
  save.addEventListener('click', async () => {
    gh.value.trim() ? LS.set('kabu_gh', gh.value.trim()) : LS.del('kabu_gh');
    gas.value.trim() ? LS.set('kabu_gas', gas.value.trim()) : LS.del('kabu_gas');
    ok.hidden = false; await loadWatch(); render(); refreshLive();
  });
  const reload = h('button', { class: 'btn', type: 'button' }, '最新のデータを読み直す'); reload.addEventListener('click', () => { closeDetail(); loadData(); });
  const forget = h('button', { class: 'btn', type: 'button' }, 'この端末の合言葉を忘れる'); forget.addEventListener('click', () => { LS.del('kabu_key'); LS.del('kabu_salt'); location.reload(); });
  const back = h('button', { class: 'ibtn', type: 'button', 'aria-label': '戻る' }, '‹'); back.style.fontSize = '24px'; back.addEventListener('click', closeDetail);
  const sh = $('#sheet'); S.detail = null;
  sh.replaceChildren(h('div', { class: 'sheet-top' }, back, h('h2', null, '設定')), h('div', { class: 'sheet-body' },
    h('div', { class: 'sec' }, h('h3', null, '見守るボタン用：GitHub の書き込み用トークン'),
      h('p', { class: 'note' }, 'kabu-app リポジトリの「Contents」だけを読み書きできるトークンを入れます。この端末の中にだけ保存します。'), gh),
    h('div', { class: 'sec' }, h('h3', null, '今の株価用：取り次ぎ先（Google Apps Script のURL）'),
      h('p', { class: 'note' }, '入れると、開いたときの株価を取りに行きます。空にすると前の晩の株価だけを出します。'), gas),
    h('div', { class: 'btns' }, save, ok), h('div', { class: 'btns' }, reload, forget)));
  sh.hidden = false; document.body.style.overflow = 'hidden';
}

// ---------- はじまり ----------
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v)));
$('#btn-live').addEventListener('click', () => { refreshLive(); });
$('#btn-set').addEventListener('click', openSettings);
document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.v === S.view ? 'page' : 'false'));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.data) refreshLive(); });
boot();
