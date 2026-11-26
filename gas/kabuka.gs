/**
 * 株チェック用の取り次ぎ役（Google Apps Script）
 *
 * 1. 今の株価：?s=5258.T,4406.T のように銘柄を受け取り、Yahoo Finance の株価を返す
 * 2. 見守り・仮に買った記録の置き場所：
 *    GET  ?watch=1           → 保存してある記録（合言葉で暗号化されたまま）を返す
 *    POST {"watch": {...}}   → 記録を保存する（中身は暗号化済みなので、ここでは読めない）
 *
 * 公開のしかた：デプロイ → デプロイを管理 → 鉛筆 → バージョン「新しいバージョン」→ デプロイ
 *   （次のユーザーとして実行：自分 ／ アクセスできるユーザー：全員）
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.watch) return json_({ watch: loadWatch_() });
  var raw = p.s || '';
  var syms = raw.split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return /^[0-9A-Z]{4}\.(T|N|S|F)$/.test(s); })
    .slice(0, 40);
  var cache = CacheService.getScriptCache();
  var quotes = {};
  var need = [];
  syms.forEach(function (s) {
    var c = cache.get('q_' + s);
    if (c) quotes[s] = JSON.parse(c); else need.push(s);
  });
  var reqs = need.map(function (s) {
    return {
      url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(s) + '?range=1d&interval=5m',
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };
  });
  var res = reqs.length ? UrlFetchApp.fetchAll(reqs) : [];
  res.forEach(function (r, i) {
    var s = need[i];
    try {
      var m = JSON.parse(r.getContentText()).chart.result[0].meta;
      var q = { price: m.regularMarketPrice, prev: m.chartPreviousClose != null ? m.chartPreviousClose : m.previousClose, time: m.regularMarketTime };
      quotes[s] = q;
      cache.put('q_' + s, JSON.stringify(q), 60);
    } catch (err) {
      quotes[s] = { error: 'not found' };
    }
  });
  return json_({ quotes: quotes, at: new Date().toISOString() });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var w = body.watch;
    if (!w || w.v !== 1 || !w.iv || !w.ct) return json_({ ok: false, error: 'bad data' });
    saveWatch_(JSON.stringify(w));
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// 1つの値は約9KBまでなので、長いときは分けて保存する
function saveWatch_(text) {
  var props = PropertiesService.getScriptProperties();
  var size = 8000, n = Math.ceil(text.length / size);
  var data = { watch_n: String(n) };
  for (var i = 0; i < n; i++) data['watch_' + i] = text.slice(i * size, (i + 1) * size);
  props.setProperties(data);
}
function loadWatch_() {
  var props = PropertiesService.getScriptProperties();
  var n = +(props.getProperty('watch_n') || 0);
  if (!n) return null;
  var t = '';
  for (var i = 0; i < n; i++) t += props.getProperty('watch_' + i) || '';
  try { return JSON.parse(t); } catch (err) { return null; }
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
