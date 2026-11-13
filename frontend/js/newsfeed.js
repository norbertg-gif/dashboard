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

function newsfeedItemHtml(item, ticker = '') {
  const title = escHtml(item.title || '');
  const url = newsfeedSafeUrl(item.url);
  let headline = title;
  if (url) headline = `<a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`;
  const key = item.url || ('title:' + String(item.title || '').trim().toLowerCase());
  const attrs = `data-news-key="${escHtml(key)}" data-news-ticker="${escHtml(ticker)}" data-news-title="${title}" data-news-url="${escHtml(item.url || '')}" data-news-kind="${escHtml(item.kind || 'wire')}"`;
  return `<div class="newsfeed-item" ${attrs}><span class="news-sent"></span>${headline}<span class="newsfeed-meta">${escHtml(item.source || '')} \u00b7 ${escHtml(newsfeedAge(item.age_hours))}</span></div>`;
}

// Sentiment titulkov (Gemini Decision 1) — spúšťa ho len tlačidlo, nikdy samo.
// Komentáre sa nehodnotia. Uložené výsledky server vráti bez volania API.
async function newsSentimentRun(rootId, btn) {
  const root = document.getElementById(rootId);
  if (!root) return;
  const nodes = [...root.querySelectorAll('.newsfeed-item[data-news-kind="wire"]')];
  if (!nodes.length) { setStatus('Žiadne správy na ohodnotenie', 'warn'); return; }
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const items = nodes.slice(0, 60).map(n => ({ ticker: n.dataset.newsTicker, title: n.dataset.newsTitle, url: n.dataset.newsUrl }));
    const r = await fetch(`${API}/api/news/sentiment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
    if (!r.ok) throw new Error(r.statusText || String(r.status));
    const data = await r.json();
    const res = data.results || {};
    let shown = 0;
    const counts = { bull: 0, bear: 0, neutral: 0 };
    for (const n of nodes) {
      const v = res[n.dataset.newsKey];
      const slot = n.querySelector('.news-sent');
      if (!v || !slot) continue;
      shown++;
      counts[v.label] = (counts[v.label] || 0) + 1;
      n.classList.remove('sent-bull', 'sent-bear', 'sent-neutral');
      n.classList.add(`sent-${v.label}`);
      const txt = v.label === 'bull' ? '▲' : v.label === 'bear' ? '▼' : '·';
      slot.className = `news-sent ${v.label}`;
      slot.textContent = txt;
      slot.title = `bullish ${Math.round(v.bull * 100)} % · bearish ${Math.round(v.bear * 100)} % (Gemini Decision 1, len z titulku)`;
    }
    if (shown) {
      const host = root.querySelector('.newsfeed-wrap') || root;
      let bar = host.querySelector(':scope > .news-sent-summary');
      if (!bar) { bar = document.createElement('div'); bar.className = 'news-sent-summary'; host.prepend(bar); }
      bar.innerHTML = `<span class="bull">▲ ${counts.bull} bullish</span><span class="bear">▼ ${counts.bear} bearish</span><span class="neutral">· ${counts.neutral} neisté</span>`;
      bar.title = 'Sentiment titulkov správ (Gemini Decision 1), komentáre sa nerátajú';
    }
    setStatus(data.error ? `Sentiment čiastočne: ${data.error}` : `Sentiment: ${shown} správ`, data.error ? 'warn' : 'ok');
  } catch (e) {
    setStatus(`Sentiment sa nepodarilo načítať: ${e.message}`, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

function newsfeedPnlHtml(row) {
  const pnl = Number(row.pnl);
  if (!Number.isFinite(pnl) || pnl === 0) return '';
  const pct = Number.isFinite(Number(row.pnl_pct)) ? ` (${pnl >= 0 ? '+' : ''}${Number(row.pnl_pct).toFixed(1)} %)` : '';
  const usd = `${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toLocaleString('sk-SK', { maximumFractionDigits: 0 })}`;
  return `<em class="newsfeed-pnl ${pnl < 0 ? 'loss' : 'profit'}" title="P/L pozície, oba účty spolu">${usd}${pct}</em>`;
}

function newsfeedRender(data, stale = false) {
  const tickers = data.tickers || [];
  const rows = tickers.map(row => {
    const wire = (row.items || []).filter(item => item.kind === 'wire');
    const commentary = (row.items || []).filter(item => item.kind === 'commentary');
    let extra = '';
    if (commentary.length) extra = `<details class="newsfeed-commentary"><summary>\u010fal\u0161ie (${commentary.length})</summary>${commentary.map(i => newsfeedItemHtml(i, row.ticker)).join('')}</details>`;
    return `<section class="newsfeed-row">
      <a class="btn mini newsfeed-ticker ticker-link" ${tickerLinkAttrs(row.ticker)} title="${escHtml(row.name || row.ticker)}"><strong>${escHtml(row.ticker)}</strong><span>${escHtml(row.name || row.ticker)}</span>${newsfeedPnlHtml(row)}</a>
      <div>${wire.map(i => newsfeedItemHtml(i, row.ticker)).join('')}${extra}</div>
    </section>`;
  }).join('');
  let without = '';
  if (data.without_news && data.without_news.length) without = `<div class="newsfeed-without">Bez spr\u00e1vy: ${data.without_news.map(ticker => escHtml(ticker)).join(', ')}</div>`;
  let retry = '';
  if (stale) retry = '<button type="button" class="btn mini" onclick="loadNewsTab(true)">Sk\u00fasi\u0165 znova</button>';
  retry += ' <button type="button" class="btn mini" onclick="newsSentimentRun(\'news-view\', this)" title="Ohodnotí titulky správ (bullish/bearish) cez Gemini Decision 1. Spustí sa len týmto tlačidlom; komentáre sa nehodnotia.">Sentiment</button>';
  let staleNote = '';
  if (stale) staleNote = '<span>neaktualizovan\u00e9</span>';
  const count = Number(data.wire_count) || 0;
  const intro = `${count} titulov s v\u00fdznamnou spr\u00e1vou \u00b7 len posledn\u00fdch 7 dn\u00ed \u00b7 zdroje: Yahoo/Finnhub · najprv tituly v strate`;
  let content = rows;
  if (!content) content = '<div class="home-empty">Za posledn\u00fdch 7 dn\u00ed sa nena\u0161la spr\u00e1va k dr\u017ean\u00fdm titulom.</div>';
  return `<div class="newsfeed-wrap"><div class="newsfeed-head"><span>${intro}</span><span>${staleNote} ${retry}</span></div>${content}${without}</div>`;
}

async function loadNewsTab(retry = false) {
  const root = document.getElementById('news-view');
  if (!root) return;
  if (_newsTabLastGood) root.innerHTML = newsfeedRender(_newsTabLastGood, Number(_newsTabLastGood.errors) > 0);
  else root.innerHTML = '<div class="newsfeed-wrap"><div class="home-empty">Na\u010d\u00edtavam spr\u00e1vy...</div></div>';
  try {
    const data = await fetchPortfolioNews(retry);
    if (!root.isConnected) return;
    root.innerHTML = newsfeedRender(data, Number(data.errors) > 0);
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
