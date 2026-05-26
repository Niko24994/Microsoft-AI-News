(() => {
  'use strict';

  const INDEX_URL = './public/news/index.json';
  const cache = {};
  let currentDate = null;
  let currentTab  = 'copilot';

  // Tabs with real M365 Roadmap data → status filter + search
  const ROADMAP_TABS  = new Set(['copilot', 'agents']);
  // Product-filter tabs
  const RELEASE_TABS  = new Set(['releasenotes']);

  const activeFilters  = {};   // status or product filter per tab
  const searchQueries  = {};   // search string per tab

  const $ = id => document.getElementById(id);
  const datePicker   = $('datePicker');
  const updatedLabel = $('updatedLabel');
  const errorBox     = $('errorBox');
  const spinner      = $('loadingSpinner');
  const panels = {
    copilot:      $('panel-copilot'),
    agents:       $('panel-agents'),
    releasenotes: $('panel-releasenotes'),
  };

  // ── Date helpers ─────────────────────────────────────────
  function formatDateLong(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function formatTimestamp(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function formatArticleDate(iso) {
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return ''; }
  }

  // ── UI helpers ───────────────────────────────────────────
  function showError(msg) { errorBox.textContent = msg; errorBox.classList.remove('hidden'); spinner.classList.add('hidden'); }
  function clearError()   { errorBox.classList.add('hidden'); errorBox.textContent = ''; }
  function setLoading(on) { spinner.classList.toggle('hidden', !on); }

  // ── CSS class helpers ────────────────────────────────────
  function slugify(s) { return (s || '').toLowerCase().replace(/\s+/g, '-'); }

  // ── Build a single card ──────────────────────────────────
  function createCard(article, isRoadmap) {
    const card = document.createElement('article');
    card.className = 'card';

    // "New" indicator ribbon
    if (article.isNew) {
      const newBadge = document.createElement('span');
      newBadge.className = 'new-badge';
      newBadge.textContent = 'NEW';
      card.appendChild(newBadge);
    }

    const meta = document.createElement('div');
    meta.className = 'card-meta';

    // Source chip
    const source = document.createElement('span');
    source.className = 'card-source';
    source.textContent = article.source || '';
    meta.appendChild(source);

    // Product badge (release notes)
    if (article.product) {
      const prod = document.createElement('span');
      prod.className = `product-badge product-${slugify(article.product)}`;
      prod.textContent = article.product;
      meta.appendChild(prod);
    }

    // Planned badge — inline after product badge, shortened label
    if (article.planned) {
      const plannedBadge = document.createElement('span');
      plannedBadge.className = 'planned-badge';
      const label = article.waveLabel || 'Planned';
      const m = label.match(/(\d{4})\s+Release\s+Wave\s+(\d)/i);
      plannedBadge.textContent = m ? `${m[1]} W${m[2]}` : label;
      meta.appendChild(plannedBadge);
    }

    // Status badge (roadmap)
    if (article.status) {
      const badge = document.createElement('span');
      badge.className = `status-badge status-${slugify(article.status)}`;
      badge.textContent = article.status;
      meta.appendChild(badge);
    }

    // Date — for roadmap items label it clearly so users know it's the "added" date
    const date = document.createElement('span');
    date.className = 'card-date';
    date.textContent = isRoadmap
      ? 'Added ' + formatArticleDate(article.date)
      : formatArticleDate(article.date);
    meta.appendChild(date);

    const title = document.createElement('h2');
    title.className = 'card-title';
    title.textContent = article.title || '';

    const summary = document.createElement('p');
    summary.className = 'card-summary';
    summary.textContent = article.summary || '';

    card.append(meta, title, summary);

    // Parsed roadmap dates (Preview / GA)
    if (article.previewDate || article.gaDate) {
      const dates = document.createElement('div');
      dates.className = 'roadmap-dates';
      if (article.previewDate) {
        const p = document.createElement('span');
        p.className = 'roadmap-date-item';
        p.innerHTML = `<span class="roadmap-date-label">Preview</span> ${article.previewDate}`;
        dates.appendChild(p);
      }
      if (article.gaDate) {
        const g = document.createElement('span');
        g.className = 'roadmap-date-item';
        g.innerHTML = `<span class="roadmap-date-label">GA</span> ${article.gaDate}`;
        dates.appendChild(g);
      }
      card.appendChild(dates);
    }

    if (article.url) {
      const link = document.createElement('a');
      link.className = 'card-link';
      link.href = article.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Read more';
      card.appendChild(link);
    }

    return card;
  }

  // ── Fill a card grid ─────────────────────────────────────
  function fillGrid(gridEl, articles, isRoadmap) {
    gridEl.innerHTML = '';
    if (!articles || articles.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty-state';
      p.textContent = 'No articles found.';
      gridEl.appendChild(p);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const a of articles) frag.appendChild(createCard(a, isRoadmap));
    gridEl.appendChild(frag);
  }

  // ── Apply filters + search and re-render ─────────────────
  function applyFilter(tab, allArticles) {
    const panel    = panels[tab];
    if (!panel) return;
    const filter   = activeFilters[tab] || '';
    const query    = (searchQueries[tab] || '').toLowerCase().trim();
    const isRoadmap = ROADMAP_TABS.has(tab);

    let filtered = allArticles;

    if (filter) {
      if (isRoadmap) filtered = filtered.filter(a => a.status === filter);
      else           filtered = filtered.filter(a => a.product === filter);
    }
    if (query) filtered = filtered.filter(a =>
      (a.title   || '').toLowerCase().includes(query) ||
      (a.summary || '').toLowerCase().includes(query)
    );

    // Update filter button states
    panel.querySelectorAll('.filter-btn').forEach(btn => {
      const isAll = !btn.dataset.filter;
      btn.classList.toggle('active', isAll ? !filter : btn.dataset.filter === filter);
    });

    // Update result count
    const countEl = panel.querySelector('.search-count');
    if (countEl) countEl.textContent = `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`;

    const grid = panel.querySelector('.card-grid');
    if (grid) fillGrid(grid, filtered, isRoadmap);
  }

  // ── Build search box ─────────────────────────────────────
  function createSearchBox(tab, allArticles) {
    const wrap = document.createElement('div');
    wrap.className = 'search-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'search-input';
    input.placeholder = 'Search…';
    input.value = searchQueries[tab] || '';
    input.setAttribute('aria-label', 'Search');

    const count = document.createElement('span');
    count.className = 'search-count';
    count.textContent = `${allArticles.length} result${allArticles.length !== 1 ? 's' : ''}`;

    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { searchQueries[tab] = input.value; applyFilter(tab, allArticles); }, 200);
    });

    wrap.append(input, count);
    return wrap;
  }

  // ── Build filter bar (status or product) ─────────────────
  function createFilterBar(tab, articles) {
    const isRoadmap = ROADMAP_TABS.has(tab);
    const bar = document.createElement('div');
    bar.className = 'status-filter';

    let options;
    if (isRoadmap) {
      const ORDER = ['In development', 'Rolling out', 'Launched', 'Cancelled'];
      options = ORDER.filter(s => articles.some(a => a.status === s));
    } else {
      // Products in order of appearance
      const seen = new Set();
      options = [];
      for (const a of articles) {
        if (a.product && !seen.has(a.product)) { seen.add(a.product); options.push(a.product); }
      }
    }

    // "All" button
    const allBtn = document.createElement('button');
    allBtn.className = 'filter-btn status-btn active';
    allBtn.textContent = `All (${articles.length})`;
    allBtn.addEventListener('click', () => { activeFilters[tab] = ''; applyFilter(tab, articles); });
    bar.appendChild(allBtn);

    for (const opt of options) {
      const count = articles.filter(a => isRoadmap ? a.status === opt : a.product === opt).length;
      const btn = document.createElement('button');
      btn.className = isRoadmap
        ? `filter-btn status-btn status-${slugify(opt)}`
        : `filter-btn status-btn product-btn product-${slugify(opt)}`;
      btn.textContent = `${opt} (${count})`;
      btn.dataset.filter = opt;
      btn.addEventListener('click', () => { activeFilters[tab] = opt; applyFilter(tab, articles); });
      bar.appendChild(btn);
    }

    return bar;
  }

  // ── Render one panel ─────────────────────────────────────
  function renderPanel(tab, articles) {
    const panel = panels[tab];
    if (!panel) return;
    panel.innerHTML = '';
    activeFilters[tab] = '';
    searchQueries[tab]  = '';

    const isRoadmap   = ROADMAP_TABS.has(tab);
    const hasFilters  = isRoadmap || RELEASE_TABS.has(tab);

    if (!articles || articles.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty-state';
      p.textContent = 'No articles available.';
      panel.appendChild(p);
      return;
    }

    if (hasFilters) {
      panel.appendChild(createSearchBox(tab, articles));
      panel.appendChild(createFilterBar(tab, articles));
    }

    const grid = document.createElement('div');
    grid.className = 'card-grid';
    panel.appendChild(grid);
    fillGrid(grid, articles, isRoadmap);
  }

  // ── Render all tabs ──────────────────────────────────────
  function renderDay(dayData) {
    const tabs = dayData.tabs || {};
    renderPanel('copilot',      tabs.copilot      || []);
    renderPanel('agents',       tabs.agents       || []);
    renderPanel('releasenotes', tabs.releasenotes || []);

    if (dayData.updated) updatedLabel.textContent = 'Updated: ' + formatTimestamp(dayData.updated);
  }

  // ── Load a day ───────────────────────────────────────────
  async function loadDay(dateStr) {
    if (cache[dateStr]) { renderDay(cache[dateStr]); return; }
    setLoading(true);
    clearError();
    try {
      const res = await fetch(`./public/news/${dateStr}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cache[dateStr] = data;
      renderDay(data);
    } catch (err) {
      showError(`Could not load data for ${formatDateLong(dateStr)}. (${err.message})`);
    } finally {
      setLoading(false);
    }
  }

  // ── Date picker ──────────────────────────────────────────
  function buildDatePicker(dates, selected) {
    datePicker.innerHTML = '';
    for (const d of dates) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = formatDateLong(d);
      if (d === selected) opt.selected = true;
      datePicker.appendChild(opt);
    }
  }

  // ── Tab switching ────────────────────────────────────────
  function activateTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(btn => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) panel.classList.toggle('active', key === tab);
    });
  }

  document.querySelectorAll('.tab').forEach(btn =>
    btn.addEventListener('click', () => activateTab(btn.dataset.tab))
  );

  datePicker.addEventListener('change', async () => {
    const d = datePicker.value;
    if (d && d !== currentDate) { currentDate = d; await loadDay(d); }
  });

  // ── Bootstrap ────────────────────────────────────────────
  async function init() {
    setLoading(true);
    clearError();
    let index;
    try {
      const res = await fetch(INDEX_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      index = await res.json();
    } catch (err) {
      showError('Could not load index. Please reload. (' + err.message + ')');
      return;
    }

    const dates  = index.dates  || [];
    const latest = index.latest || (dates[0] ?? null);

    if (!dates.length || !latest) {
      showError('No data yet. Please trigger the GitHub Actions workflow manually.');
      setLoading(false);
      return;
    }

    buildDatePicker(dates, latest);
    currentDate = latest;
    await loadDay(latest);
  }

  init();
})();
