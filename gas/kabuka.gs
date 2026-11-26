/**
 * 株チェック用：今の株価の取り次ぎ役（Google Apps Script）
 *
 * アプリから ?s=5258.T,4406.T のように銘柄を受け取り、
 * Yahoo Finance の株価を取ってきて JSON で返すだけ。株価以外のことはしない。
 *
 * 公開のしかた：デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *   次のユーザーとして実行：自分 ／ アクセスできるユーザー：全員
 *   出てきた「ウェブアプリのURL」（…/exec で終わるもの）をアプリの設定に入れる
 */
function doGet(e) {
  var raw = (e && e.parameter && e.parameter.s) || '';
  var syms = raw.split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return /^[0-9A-Z]{4}\.(T|N|S|F)$/.test(s); })
    .slice(0, 40);  // 1回に40銘柄まで
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
      var q = {
        price: m.regularMarketPrice,
        prev: m.chartPreviousClose != null ? m.chartPreviousClose : m.previousClose,
        time: m.regularMarketTime
      };
      quotes[s] = q;
      cache.put('q_' + s, JSON.stringify(q), 60);  // 同じ銘柄は1分間使い回す
    } catch (err) {
      quotes[s] = { error: 'not found' };
    }
  });
  return ContentService.createTextOutput(JSON.stringify({ quotes: quotes, at: new Date().toISOString() }))
    .setMimeType(ContentService.MimeType.JSON);
}
