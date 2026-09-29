let _newsTabLastGood = null;
let _newsTabRequest = null;
let _homeNewsSummaryRequest = null;

function newsfeedAge(hours) {
  const value = Math.max(0, Number(hours) || 0);
  if (value < 1) return `${Math.max(1, Math.round(value * 60))} min`;
  if (value < 24) return `${Math.floor(value)} h`;
  return `${Math.floor(value / 24)} d`;
}

async function fetchPortfolioNews(force = false) {
  if (!force && _newsTabRequest) return _newsTabRequest;
  _newsTabRequest = (async () => {
    const response = await fetch(`${API}/api/news/portfolio`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    _newsTabLastGood = data;
    return data;
  })();
  try { return await _newsTabRequest; }
  finally { _newsTabRequest = null; }
}

function newsfeedSafeUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    return '';
  } catch (e) { return ''; }
}

function newsfeedItemHtml(item) {
  const title = escHtml(item.title || '');
  const url = newsfeedSafeUrl(item.url);
  let headline = title;
  if (url) headline = `<a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`;
  return `<div class="newsfeed-item">${headline}<span class="newsfeed-meta">${escHtml(item.source || '')} \u00b7 ${escHtml(newsfeedAge(item.age_hours))}</span></div>`;
}

function newsfeedRender(data, stale = false) {
  const tickers = data.tickers || [];
  const rows = tickers.map(row => {
    const wire = (row.items || []).filter(item => item.kind === 'wire');
    const commentary = (row.items || []).filter(item => item.kind === 'commentary');
    let extra = '';
    if (commentary.length) extra = `<details class="newsfeed-commentary"><summary>\u010fal\u0161ie (${commentary.length})</summary>${commentary.map(newsfeedItemHtml).join('')}</details>`;
    return `<section class="newsfeed-row">
      <button type="button" class="btn mini newsfeed-ticker" data-news-ticker="${escHtml(row.ticker)}" title="${escHtml(row.name || row.ticker)}"><strong>${escHtml(row.ticker)}</strong><span>${escHtml(row.name || row.ticker)}</span></button>
      <div>${wire.map(newsfeedItemHtml).join('')}${extra}</div>
      <div class="newsfeed-sent" data-sent-ticker="${escHtml(row.ticker)}">${newsfeedSentimentCellHtml(row.ticker)}</div>
      <div class="newsfeed-av" data-av-ticker="${escHtml(row.ticker)}">${newsfeedAvPanelHtml(row.ticker)}</div>
    </section>`;
  }).join('');
  let without = '';
  if (data.without_news && data.without_news.length) without = `<div class="newsfeed-without">Bez spr\u00e1vy: ${data.without_news.map(ticker => escHtml(ticker)).join(', ')}</div>`;
  let retry = '';
  if (stale) retry = '<button type="button" class="btn mini" onclick="loadNewsTab(true)">Sk\u00fasi\u0165 znova</button>';
  let staleNote = '';
  if (stale) staleNote = '<span>neaktualizovan\u00e9</span>';
  const count = Number(data.wire_count) || 0;
  const intro = `${count} titulov s v\u00fdznamnou spr\u00e1vou \u00b7 len posledn\u00fdch 7 dn\u00ed \u00b7 zdroje: Yahoo/Finnhub`;
  let content = rows;
  if (!content) content = '<div class="home-empty">Za posledn\u00fdch 7 dn\u00ed sa nena\u0161la spr\u00e1va k dr\u017ean\u00fdm titulom.</div>';
  return `<div class="newsfeed-wrap"><div class="newsfeed-head"><span>${intro}</span><span>${staleNote} ${retry}</span></div>${content}${without}</div>`;
}

// ── Alpha Vantage sentiment — VÝHRADNE na klik (25 req/deň, 1 request na titul).
// Nikdy sa nevolá hromadne ani automaticky pri otvorení záložky.
const _newsSentimentCache = {};   // { TICKER: {data} | {error} | {loading:true} }

function newsfeedSentimentLabel(avg) {
  if (avg <= -0.35) return 'Bearish';
  if (avg <= -0.15) return 'Somewhat-Bearish';
  if (avg < 0.15) return 'Neutral';
  if (avg < 0.35) return 'Somewhat-Bullish';
  return 'Bullish';
}

function newsfeedSentimentCellHtml(ticker) {
  const state = _newsSentimentCache[ticker];
  const btn = (text) => `<button type="button" class="btn mini" data-sent-load="${escHtml(ticker)}" title="Alpha Vantage NEWS_SENTIMENT — 1 z 25 denných dotazov">${text}</button>`;
  if (!state) return btn('Sentiment');
  if (state.loading) return '<span class="newsfeed-meta"><span class="cl-spinner"></span> načítavam…</span>';
  if (state.error) return `<span class="newsfeed-meta" title="${escHtml(state.error)}">${escHtml(state.error)}</span> ${btn('Skúsiť znova')}`;
  const summary = newsSummaryFromItems(state.items || []);
  if (!summary) return `<span class="newsfeed-meta">bez hodnotenia (${(state.items || []).length} článkov)</span>`;
  const label = newsfeedSentimentLabel(summary.avg);
  const stale = state.stale ? ' · staré dáta' : '';
  const open = !!state.open;
  return `${newsSentimentBadge(label, summary.avg)}<button type="button" class="btn mini" data-av-toggle="${escHtml(ticker)}" title="Články, z ktorých je sentiment počítaný">${summary.n} udalostí ${open ? '▴' : '▾'}</button>${stale ? `<span class="newsfeed-meta">${stale.replace(' · ', '')}</span>` : ''}`;
}

// Články z Alpha Vantage (už stiahnuté pri kliku na Sentiment — otvorenie nestojí ďalší dotaz).
function newsfeedAvPanelHtml(ticker) {
  const state = _newsSentimentCache[ticker];
  if (!state || !state.open || !(state.items || []).length) return '';
  const rows = state.items.map(item => {
    const url = newsfeedSafeUrl(item.url);
    const title = escHtml(item.title || '');
    const headline = url ? `<a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title;
    const badge = Number.isFinite(item.sentiment_score)
      ? newsSentimentBadge(item.sentiment_label || newsfeedSentimentLabel(item.sentiment_score), item.sentiment_score) : '';
    const hours = item.time_published ? (Date.now() - Date.parse(item.time_published)) / 3600000 : NaN;
    const age = Number.isFinite(hours) ? ` · ${escHtml(newsfeedAge(hours))}` : '';
    const dup = item.cluster_primary === false ? ' · <em>duplicita</em>' : '';
    return `<div class="newsfeed-item">${headline}<span class="newsfeed-meta">${escHtml(item.source || '')}${age}${dup}</span> ${badge}</div>`;
  }).join('');
  return `<div class="newsfeed-av-head">Alpha Vantage · články so sentimentom (${state.items.length})</div>${rows}`;
}

async function newsfeedLoadSentiment(ticker) {
  if ((_newsSentimentCache[ticker] || {}).loading) return;
  _newsSentimentCache[ticker] = { loading: true };
  newsfeedPatchSentiment(ticker);
  try {
    const r = await fetch(`${API}/api/news/${encodeURIComponent(ticker)}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let data = await r.json();
    if (data.error && !(data.items || []).length && typeof fetchTickerNewsDirect === 'function') {
      const direct = await fetchTickerNewsDirect(ticker);   // per-IP limit na Renderi → z prehliadača
      if (direct) data = direct;
    }
    _newsSentimentCache[ticker] = data.error && !(data.items || []).length
      ? { error: String(data.error).slice(0, 120) } : data;
  } catch (e) {
    _newsSentimentCache[ticker] = { error: String(e.message || e).slice(0, 120) };
  }
  newsfeedPatchSentiment(ticker);
}

function newsfeedPatchSentiment(ticker) {
  document.querySelectorAll('[data-sent-ticker]').forEach(cell => {
    if (cell.dataset.sentTicker !== ticker) return;
    cell.innerHTML = newsfeedSentimentCellHtml(ticker);
    newsfeedBindSentiment(cell);
  });
  document.querySelectorAll('[data-av-ticker]').forEach(panel => {
    if (panel.dataset.avTicker === ticker) panel.innerHTML = newsfeedAvPanelHtml(ticker);
  });
}

function newsfeedToggleAv(ticker) {
  const state = _newsSentimentCache[ticker];
  if (!state || !state.items) return;
  state.open = !state.open;
  newsfeedPatchSentiment(ticker);
}

function newsfeedBindSentiment(root) {
  root.querySelectorAll('[data-av-toggle]').forEach(button => {
    button.addEventListener('click', () => newsfeedToggleAv(button.dataset.avToggle));
  });
  root.querySelectorAll('[data-sent-load]').forEach(button => {
    button.addEventListener('click', () => newsfeedLoadSentiment(button.dataset.sentLoad));
  });
}

function newsfeedBindTickers(root) {
  newsfeedBindSentiment(root);
  root.querySelectorAll('[data-news-ticker]').forEach(button => {
    button.addEventListener('click', () => openScannerTicker(button.dataset.newsTicker));
  });
}

async function loadNewsTab(retry = false) {
  const root = document.getElementById('news-view');
  if (!root) return;
  if (_newsTabLastGood) root.innerHTML = newsfeedRender(_newsTabLastGood, Number(_newsTabLastGood.errors) > 0);
  else root.innerHTML = '<div class="newsfeed-wrap"><div class="home-empty">Na\u010d\u00edtavam spr\u00e1vy...</div></div>';
  newsfeedBindTickers(root);
  try {
    const data = await fetchPortfolioNews(retry);
    if (!root.isConnected) return;
    root.innerHTML = newsfeedRender(data, Number(data.errors) > 0);
    newsfeedBindTickers(root);
  } catch (error) {
    if (!root.isConnected) return;
    if (_newsTabLastGood) root.innerHTML = newsfeedRender(_newsTabLastGood, true);
    else root.innerHTML = `<div class="newsfeed-wrap"><div class="home-empty">Spr\u00e1vy sa nepodarilo na\u010d\u00edta\u0165. <button type="button" class="btn mini" onclick="loadNewsTab(true)">Sk\u00fasi\u0165 znova</button></div></div>`;
  }
}

async function loadHomeNewsSummary() {
  const button = document.getElementById('news-summary-link');
  if (!button) return;
  try {
    if (!_homeNewsSummaryRequest) _homeNewsSummaryRequest = fetchPortfolioNews();
    const data = await _homeNewsSummaryRequest;
    _homeNewsSummaryRequest = null;
    if (!button.isConnected) return;
    const count = Number(data.wire_count) || 0;
    button.textContent = `Spr\u00e1vy: ${count} titulov s v\u00fdznamnou spr\u00e1vou \u2192 otvori\u0165`;
    button.hidden = count === 0;
  } catch (error) {
    _homeNewsSummaryRequest = null;
    if (button.isConnected) button.hidden = true;
  }
}
