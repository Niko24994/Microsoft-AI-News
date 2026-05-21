(() => {
  'use strict';

  const INDEX_URL = './public/news/index.json';
  const cache = {};
  let currentDate = null;
  let currentTab = 'powerplatform';

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
    return new Date(y, m - 1, d).toLocaleDateString('de-DE', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  function formatDateShort(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  }

  function formatTimestamp(isoString) {
    const d = new Date(isoString);
    return d.toLocaleDateString('de-DE', {
      day: 'numeric', month: 'long', year: 'numeric',
    }) + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  }

  function formatArticleDate(isoString) {
    try {
      return new Date(isoString).toLocaleDateString('de-DE', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch {
      return '';
    }
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

  // ── Build date picker options ────────────────────────────
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

  // ── Render a single news card ────────────────────────────
  function createCard(article) {
    const card = document.createElement('article');
    card.className = 'card';

    const meta = document.createElement('div');
    meta.className = 'card-meta';

    const source = document.createElement('span');
    source.className = 'card-source';
    source.textContent = article.source || '';

    const date = document.createElement('span');
    date.className = 'card-date';
    date.textContent = formatArticleDate(article.date);

    meta.append(source, date);

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
      link.textContent = 'Artikel lesen';
      card.appendChild(link);
    }

    return card;
  }

  // ── Render one tab panel ─────────────────────────────────
  function renderPanel(tab, articles) {
    const panel = panels[tab];
    panel.innerHTML = '';

    if (!articles || articles.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Keine Artikel verfügbar.';
      panel.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const article of articles) {
      fragment.appendChild(createCard(article));
    }
    panel.appendChild(fragment);
  }

  // ── Render all tabs from a day object ────────────────────
  function renderDay(dayData) {
    const tabs = dayData.tabs || {};
    renderPanel('powerplatform', tabs.powerplatform || []);
    renderPanel('fabric',        tabs.fabric        || []);
    renderPanel('powerbi',       tabs.powerbi       || []);
    renderPanel('copilot',       tabs.copilot       || []);
    renderPanel('agents',        tabs.agents        || []);

    if (dayData.updated) {
      updatedLabel.textContent = 'Stand: ' + formatTimestamp(dayData.updated);
    }
  }

  // ── Load a day (with in-memory cache) ────────────────────
  async function loadDay(dateStr) {
    if (cache[dateStr]) {
      renderDay(cache[dateStr]);
      return;
    }

    setLoading(true);
    clearError();

    try {
      const res = await fetch(`./public/news/${dateStr}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      cache[dateStr] = data;
      renderDay(data);
    } catch (err) {
      showError(`Daten für ${formatDateLong(dateStr)} konnten nicht geladen werden. (${err.message})`);
    } finally {
      setLoading(false);
    }
  }

  // ── Tab switching ─────────────────────────────────────────
  function activateTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    Object.entries(panels).forEach(([key, panel]) => {
      panel.classList.toggle('active', key === tab);
    });
  }

  // ── Event: tab click ─────────────────────────────────────
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  // ── Event: date picker change ─────────────────────────────
  datePicker.addEventListener('change', async () => {
    const d = datePicker.value;
    if (d && d !== currentDate) {
      currentDate = d;
      await loadDay(d);
    }
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
      showError('Index konnte nicht geladen werden. Bitte Seite neu laden. (' + err.message + ')');
      return;
    }

    const dates = index.dates || [];
    const latest = index.latest || (dates[0] ?? null);

    if (dates.length === 0 || !latest) {
      showError('Noch keine Daten vorhanden. Bitte den GitHub Actions Workflow manuell starten.');
      setLoading(false);
      return;
    }

    buildDatePicker(dates, latest);
    currentDate = latest;
    await loadDay(latest);
  }

  init();
})();
