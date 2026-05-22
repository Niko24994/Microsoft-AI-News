(() => {
  'use strict';

  const INDEX_URL = './public/news/index.json';
  const cache = {};
  let currentDate = null;
  let currentTab = 'powerplatform';

  // Tabs using real M365 Roadmap RSS — support status filtering + search
  const ROADMAP_TABS = new Set(['copilot', 'agents']);
  const activeFilters = {};
  const searchQueries  = {};

  const $ = (id) => document.getElementById(id);
  const datePicker   = $('datePicker');
  const updatedLabel = $('updatedLabel');
  const errorBox     = $('errorBox');
  const spinner      = $('loadingSpinner');
  const panels = {
    powerplatform: $('panel-powerplatform'),
    fabric:        $('panel-fabric'),
    powerbi:       $('panel-powerbi'),
    copilot:       $('panel-copilot'),
    agents:        $('panel-agents'),
  };

  // ── Date formatting ──────────────────────────────────────
  function formatDateLong(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  function formatTimestamp(isoString) {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function formatArticleDate(isoString) {
    try {
      return new Date(isoString).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch { return ''; }
  }

  // ── UI helpers ───────────────────────────────────────────
  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
    spinner.classList.add('hidden');
  }

  function clearError() {
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
  }

  function setLoading(on) {
    spinner.classList.toggle('hidden', !on);
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

  // ── Status badge CSS class ───────────────────────────────
  function statusClass(status) {
    return 'status-' + (status || '').toLowerCase().replace(/\s+/g, '-');
  }

  // ── Build a single news card ─────────────────────────────
  function createCard(article) {
    const card = document.createElement('article');
    card.className = 'card';

    const meta = document.createElement('div');
    meta.className = 'card-meta';

    const source = document.createElement('span');
    source.className = 'card-source';
    source.textContent = article.source || '';
    meta.appendChild(source);

    if (article.status) {
      const badge = document.createElement('span');
      badge.className = `status-badge ${statusClass(article.status)}`;
      badge.textContent = article.status;
      meta.appendChild(badge);
    }

    const date = document.createElement('span');
    date.className = 'card-date';
    date.textContent = formatArticleDate(article.date);
    meta.appendChild(date);

    const title = document.createElement('h2');
    title.className = 'card-title';
    title.textContent = article.title || '';

    const summary = document.createElement('p');
    summary.className = 'card-summary';
    summary.textContent = article.summary || '';

    card.append(meta, title, summary);

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

  // ── Fill a card grid element ─────────────────────────────
  function fillGrid(gridEl, articles) {
    gridEl.innerHTML = '';
    if (!articles || articles.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No articles available.';
      gridEl.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const a of articles) frag.appendChild(createCard(a));
    gridEl.appendChild(frag);
  }

  // ── Apply status filter + search and re-render grid ────────
  function applyFilter(tab, allArticles) {
    const panel = panels[tab];
    if (!panel) return;
    const filter = activeFilters[tab] || '';
    const query  = (searchQueries[tab] || '').toLowerCase().trim();

    let filtered = allArticles;
    if (filter) filtered = filtered.filter(a => a.status === filter);
    if (query)  filtered = filtered.filter(a =>
      (a.title   || '').toLowerCase().includes(query) ||
      (a.summary || '').toLowerCase().includes(query)
    );

    // Update status button active states
    panel.querySelectorAll('.status-btn').forEach(btn => {
      const isAll = !btn.dataset.status;
      btn.classList.toggle('active', isAll ? !filter : btn.dataset.status === filter);
    });

    // Update result count in search box placeholder area
    const countEl = panel.querySelector('.search-count');
    if (countEl) countEl.textContent = `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`;

    const grid = panel.querySelector('.card-grid');
    if (grid) fillGrid(grid, filtered);
  }

  // ── Build search box ─────────────────────────────────────
  function createSearchBox(tab, allArticles) {
    const wrap = document.createElement('div');
    wrap.className = 'search-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'search-input';
    input.placeholder = 'Search features…';
    input.value = searchQueries[tab] || '';
    input.setAttribute('aria-label', 'Search features');

    const count = document.createElement('span');
    count.className = 'search-count';
    count.textContent = `${allArticles.length} result${allArticles.length !== 1 ? 's' : ''}`;

    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        searchQueries[tab] = input.value;
        applyFilter(tab, allArticles);
      }, 200);
    });

    wrap.append(input, count);
    return wrap;
  }

  // ── Build status filter bar ──────────────────────────────
  function createFilterBar(tab, articles) {
    const ORDER = ['In development', 'Rolling out', 'Launched', 'Cancelled'];
    const present = ORDER.filter(s => articles.some(a => a.status === s));

    const bar = document.createElement('div');
    bar.className = 'status-filter';

    // "All" button
    const allBtn = document.createElement('button');
    allBtn.className = 'status-btn active';
    allBtn.textContent = `All (${articles.length})`;
    allBtn.addEventListener('click', () => { activeFilters[tab] = ''; applyFilter(tab, articles); });
    bar.appendChild(allBtn);

    // Per-status buttons
    for (const status of present) {
      const count = articles.filter(a => a.status === status).length;
      const btn = document.createElement('button');
      btn.className = `status-btn ${statusClass(status)}`;
      btn.textContent = `${status} (${count})`;
      btn.dataset.status = status;
      btn.addEventListener('click', () => { activeFilters[tab] = status; applyFilter(tab, articles); });
      bar.appendChild(btn);
    }

    return bar;
  }

  // ── Render one tab panel ─────────────────────────────────
  function renderPanel(tab, articles) {
    const panel = panels[tab];
    if (!panel) return;
    panel.innerHTML = '';

    if (ROADMAP_TABS.has(tab)) {
      activeFilters[tab] = '';   // reset filter on new data
      searchQueries[tab]  = '';  // reset search on new data

      if (!articles || articles.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No articles available.';
        panel.appendChild(empty);
        return;
      }

      panel.appendChild(createSearchBox(tab, articles));
      panel.appendChild(createFilterBar(tab, articles));
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      panel.appendChild(grid);
      fillGrid(grid, articles);

    } else {
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      fillGrid(grid, articles);
      panel.appendChild(grid);
    }
  }

  // ── Render all tabs from a day's data ────────────────────
  function renderDay(dayData) {
    const tabs = dayData.tabs || {};
    renderPanel('powerplatform', tabs.powerplatform || []);
    renderPanel('fabric',        tabs.fabric        || []);
    renderPanel('powerbi',       tabs.powerbi       || []);
    renderPanel('copilot',       tabs.copilot       || []);
    renderPanel('agents',        tabs.agents        || []);

    if (dayData.updated) {
      updatedLabel.textContent = 'Updated: ' + formatTimestamp(dayData.updated);
    }
  }

  // ── Load a day (with cache) ──────────────────────────────
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

  // ── Tab switching ────────────────────────────────────────
  function activateTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(btn => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) panel.classList.toggle('active', key === tab);
    });
  }

  // ── Events ───────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

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

    if (dates.length === 0 || !latest) {
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
