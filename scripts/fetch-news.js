import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

const parser = new Parser({ timeout: 10000 });
const NEWS_DIR = path.resolve('public/news');
const MAX_AGE_DAYS = 180;

// ── M365 Roadmap tabs ────────────────────────────────────────────────────────
const ROADMAP_FEEDS = {
  copilot: {
    url: 'https://www.microsoft.com/releasecommunications/api/v2/m365/rss',
    keywords: ['copilot'],
  },
  agents: {
    url: 'https://www.microsoft.com/releasecommunications/api/v2/m365/rss',
    keywords: ['copilot studio', 'agent'],
  },
};

// ── Release Notes: product blog feeds ───────────────────────────────────────
// skipFilter: true → show all posts (focused sub-blogs only publish product content)
const RELEASE_FEEDS = [
  { url: 'https://community.fabric.microsoft.com/oxcrx34285/rss/board?board.id=fbc_fabricupdatesblogs', product: 'Fabric' },
  { url: 'https://community.fabric.microsoft.com/oxcrx34285/rss/board?board.id=fbc_pbiupdatesblog',     product: 'Power BI' },
  { url: 'https://www.microsoft.com/en-us/power-platform/blog/feed/',                     product: 'Power Platform' },
  { url: 'https://www.microsoft.com/en-us/power-platform/blog/power-automate/feed/',      product: 'Power Automate', skipFilter: true },
  { url: 'https://www.microsoft.com/en-us/power-platform/blog/power-apps/feed/',          product: 'Power Apps',     skipFilter: true },
  { url: 'https://www.microsoft.com/en-us/power-platform/blog/power-pages/feed/',         product: 'Power Pages',    skipFilter: true },
];

const RELEASE_KEYWORDS = [
  'preview', 'generally available', ' ga ', "what's new", "what's new",
  'feature summary', 'feature update', 'roadmap', 'upcoming', 'retiring',
  'deprecated', 'deprecation', 'release plan', 'public preview', 'private preview',
  'coming soon', 'now available', 'release notes', 'feature release',
  'monthly update', 'desktop update', 'service update', 'update',
  'introducing', 'introduces', 'announcing', 'announced', 'new in', 'now in',
  'launching', 'launched', 'available in', 'rolling out', 'general availability',
  'new feature', 'new connector', 'new capability', 'new experience',
  'enhanced', 'enhancements', 'improved', 'improvements',
  'release wave',
];

// ── Release Wave: official Microsoft release plan feature entries ─────────────
// Each product has a scoped Learn RSS feed updated weekly by Microsoft.
// Scope format: [product-slug]-[YY][W]  e.g. power-apps-261 = 2026 Wave 1
const WAVE_PRODUCTS = [
  { scope: 'power-apps',                            product: 'Power Apps' },
  { scope: 'power-automate',                        product: 'Power Automate' },
  { scope: 'power-pages',                           product: 'Power Pages' },
  { scope: 'microsoft-copilot-studio',              product: 'Copilot Studio' },
  { scope: 'data-platform',                         product: 'Dataverse' },
  { scope: 'power-platform-governance-administration', product: 'Power Platform Admin' },
];

// Title patterns that mark overview / investment-area items (not individual features)
const WAVE_OVERVIEW_RE = [
  /^new and planned features for /i,
  /^overview of /i,
  /^[a-z][a-z\s]+ - (building|enabling|enterprise scale|copilot for|govern)/i,
  /\d{4} release wave \d features available in additional products/i,
];

// ── Roadmap status/category helpers ─────────────────────────────────────────
const STATUS_VALUES = ['In development', 'Rolling out', 'Launched', 'Cancelled'];

const NON_PRODUCT_CATS = new Set([
  ...STATUS_VALUES,
  'Worldwide (Standard Multi-Tenant)', 'GCC', 'GCC High', 'DoD',
  'Web', 'Desktop', 'Mac', 'Android', 'iOS', 'Mobile', 'Developer',
  'Linux', 'Teams and Surface Devices',
  'General Availability', 'Preview', 'Targeted Release', 'Current Channel',
]);

// Sources not relevant for a Power Platform / Fabric audience — filtered from
// both the Copilot and Agents roadmap tabs.
const ROADMAP_EXCLUDE_SOURCES = new Set([
  'Microsoft Viva',
  'PowerPoint',
  'Outlook',
  'Microsoft Teams',
  'Word',
  'OneNote',
  'Microsoft Edge',
  'OneDrive',
  'Microsoft Clipchamp',
  'Forms',
  'Microsoft Kaizala',
  'Microsoft Whiteboard',
  'Microsoft To Do',
  'Microsoft Planner',
  'Yammer',
  'Stream',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate the current Microsoft release wave ID.
 * Format: [2-digit year][wave]  →  "261" = 2026 Wave 1
 *   April–September  → Wave 1 of the current year
 *   October–December → Wave 2 of the current year
 *   January–March    → Wave 2 of the previous year (still running)
 */
function getCurrentWave() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1–12
  if (month >= 4 && month <= 9) return `${year % 100}1`;
  if (month >= 10)              return `${year % 100}2`;
  return `${(year - 1) % 100}2`;   // Jan–Mar: previous year's Wave 2
}

/** Human-readable wave label, e.g. "261" → "2026 Release Wave 1" */
function waveLabel(wave) {
  const year  = `20${wave.slice(0, 2)}`;
  const waveN = wave.slice(2);
  return `${year} Release Wave ${waveN}`;
}

// Parse "Preview date: June CY2026" / "GA date: July CY2026" from roadmap text
function parseRoadmapDates(text) {
  const t     = text || '';
  const MY    = '[A-Za-z]+\\s+(?:CY)?20\\d{2}';
  const clean = s => s.replace(/CY/i, '').trim();

  const previewMatch = t.match(new RegExp(
    `(?:preview\\s+(?:date|available)|preview)\\s*:?\\s*(${MY})`, 'i'
  ));
  const gaMatch = t.match(new RegExp(
    `(?:ga\\s+date|general\\s+availability|rollout\\s+start(?:s)?)\\s*:?\\s*(${MY})`, 'i'
  ));

  const result = {};
  if (previewMatch) result.previewDate = clean(previewMatch[1]);
  if (gaMatch)      result.gaDate      = clean(gaMatch[1]);
  return result;
}

// Build a Set of all article URLs from a saved JSON file (for "new" detection)
function loadUrlSet(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const urls = new Set();
    for (const articles of Object.values(data.tabs || {})) {
      if (!Array.isArray(articles)) continue;
      for (const a of articles) { if (a.url) urls.add(a.url); }
    }
    return urls;
  } catch { return new Set(); }
}

async function fetchFeed(url) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout after 8s')), 8000)
  );
  try {
    const feed = await Promise.race([parser.parseURL(url), timeout]);
    return feed.items || [];
  } catch (err) {
    console.warn(`  [WARN] Feed unreachable: ${url} — ${err.message}`);
    return [];
  }
}

// ── Fetch functions ──────────────────────────────────────────────────────────

async function fetchRoadmapTab(tabKey) {
  const { url, keywords } = ROADMAP_FEEDS[tabKey];
  console.log(`\n[${tabKey}] Loading roadmap RSS…`);
  console.log(`  → ${url}`);
  const items = await fetchFeed(url);

  const result = [];
  for (const item of items) {
    const categories = item.categories || [];
    const catText    = categories.join(' ').toLowerCase();
    const titleText  = (item.title || '').toLowerCase();
    if (!keywords.some(kw => catText.includes(kw) || titleText.includes(kw))) continue;

    const status = categories.find(c => STATUS_VALUES.includes(c)) || null;
    const source = categories.find(c => !NON_PRODUCT_CATS.has(c)) || 'Microsoft 365 Roadmap';

    // Skip sources not relevant for Power Platform / Fabric audience
    if (ROADMAP_EXCLUDE_SOURCES.has(source)) continue;

    const summary = (item.contentSnippet || item.description || '')
      .replace(/<[^>]+>/g, '').trim().slice(0, 600);

    const entry = {
      title:  (item.title || '').trim(),
      summary,
      source,
      url:    item.link || item.guid || '',
      date:   item.isoDate || item.pubDate || new Date().toISOString(),
    };
    if (status) entry.status = status;
    const parsedDates = parseRoadmapDates(summary);
    if (parsedDates.previewDate) entry.previewDate = parsedDates.previewDate;
    if (parsedDates.gaDate)      entry.gaDate      = parsedDates.gaDate;
    result.push(entry);
  }

  result.sort((a, b) => new Date(b.date) - new Date(a.date));
  console.log(`  → ${result.length} items`);
  return result;
}

async function fetchReleaseNotes() {
  console.log('\n[releasenotes] Loading blog feeds…');
  const allItems = [];

  for (const { url, product, skipFilter } of RELEASE_FEEDS) {
    console.log(`  → ${url} [${product}]${skipFilter ? ' (no filter)' : ''}`);
    const items = await fetchFeed(url);
    for (const item of items) {
      const title = (item.title || '').toLowerCase();
      if (!skipFilter && !RELEASE_KEYWORDS.some(kw => title.includes(kw))) continue;
      allItems.push({
        title:   (item.title || '').trim(),
        summary: (item.contentSnippet || item.summary || item.content || '')
          .replace(/<[^>]+>/g, '').trim().slice(0, 500),
        source:  item.creator || new URL(url).hostname,
        product,
        url:     item.link || item.guid || '',
        date:    item.isoDate || item.pubDate || new Date().toISOString(),
      });
    }
    await sleep(300);
  }

  const seen = new Set();
  const unique = allItems.filter(a => {
    if (!a.url || seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  unique.sort((a, b) => new Date(b.date) - new Date(a.date));
  console.log(`  → ${unique.length} release notes`);
  return unique;
}

async function fetchReleasePlan() {
  const wave = getCurrentWave();
  const label = waveLabel(wave);
  console.log(`\n[releasewave] Loading ${label} plan…`);
  const allItems = [];

  for (const { scope, product } of WAVE_PRODUCTS) {
    const scopeId = `${scope}-${wave}`;
    const url = `https://learn.microsoft.com/api/search/rss?locale=en-us&$filter=scopes%2Fany(t%3A%20t%20eq%20%27${scopeId}%27)`;
    console.log(`  → ${product} [${scopeId}]`);
    const items = await fetchFeed(url);

    for (const item of items) {
      const title = (item.title || '').trim();
      // Skip overview / investment-area items (not individual features)
      if (WAVE_OVERVIEW_RE.some(re => re.test(title))) continue;

      allItems.push({
        title,
        summary: (item.contentSnippet || item.summary || item.content || '')
          .replace(/<[^>]+>/g, '').trim().slice(0, 500),
        source:  'Release Wave Plan',
        product,
        url:     item.link || item.guid || '',
        date:    item.isoDate || item.pubDate || new Date().toISOString(),
      });
    }
    await sleep(300);
  }

  const seen = new Set();
  const unique = allItems.filter(a => {
    if (!a.url || seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  unique.sort((a, b) => new Date(b.date) - new Date(a.date));
  console.log(`  → ${unique.length} planned features (${label})`);
  return { items: unique, wave, label };
}

// ── Housekeeping ─────────────────────────────────────────────────────────────

function deleteOldFiles() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);
  const files = fs.readdirSync(NEWS_DIR);
  let deleted = 0;
  for (const file of files) {
    if (file === 'index.json') continue;
    const match = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) continue;
    if (new Date(match[1]) < cutoff) {
      fs.unlinkSync(path.join(NEWS_DIR, file));
      console.log(`  [ARCHIVE] Deleted: ${file}`);
      deleted++;
    }
  }
  if (deleted === 0) console.log('  [ARCHIVE] No old files to delete');
}

function updateIndex(today) {
  const files = fs.readdirSync(NEWS_DIR);
  const dates = files
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.replace('.json', ''))
    .sort((a, b) => b.localeCompare(a));
  const index = { latest: today, dates };
  fs.writeFileSync(path.join(NEWS_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`\n[INDEX] ${dates.length} days available, latest: ${today}`);
}

// ── Fabric Roadmap scraper (Puppeteer) ───────────────────────────────────────

async function fetchFabricRoadmap() {
  console.log('\n[fabricroadmap] Launching headless browser…');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    console.log('  → Navigating to roadmap.fabric.microsoft.com…');
    await page.goto('https://roadmap.fabric.microsoft.com/', {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });

    // Wait for sidebar categories to appear
    await page.waitForSelector('ul li a, nav a, [class*="category"], [class*="sidebar"] a', {
      timeout: 20000,
    }).catch(() => console.warn('  [WARN] Sidebar selector timeout — continuing anyway'));

    await sleep(2000); // Let JS fully render

    // Extract all categories from the left sidebar
    const categories = await page.evaluate(() => {
      // The left sidebar typically has a list of plain text links
      const candidates = [
        ...document.querySelectorAll('aside a, nav li a, [class*="sidebar"] a, [class*="nav-item"] a, ul li a'),
      ];
      const seen = new Set();
      const cats = [];
      for (const el of candidates) {
        const text = el.textContent.trim();
        if (!text || seen.has(text) || text.length > 80) continue;
        // Skip top-nav items like "Forums", "Ideas", "Blogs" etc.
        const skip = ['forums','inspiration','ideas','communities','blogs','learning','support','home'];
        if (skip.some(s => text.toLowerCase().includes(s))) continue;
        seen.add(text);
        cats.push({ text, href: el.href });
      }
      return cats;
    });

    console.log(`  → Found ${categories.length} categories: ${categories.map(c => c.text).join(', ')}`);

    const allFeatures = [];

    for (const cat of categories) {
      console.log(`  → Scraping: ${cat.text}`);
      try {
        // Click the category link
        await page.evaluate((href) => {
          const links = [...document.querySelectorAll('a')];
          const link = links.find(l => l.href === href || l.textContent.trim() === href);
          if (link) link.click();
        }, cat.href || cat.text);

        await sleep(1200); // Wait for features to load

        // Extract features from the main content area
        const features = await page.evaluate((catName) => {
          const results = [];

          // Feature rows — try common patterns
          const rows = document.querySelectorAll(
            '[class*="feature-row"], [class*="roadmap-item"], [class*="item-row"], ' +
            'table tr, [class*="list-item"], [class*="card"], [role="row"], ' +
            '[class*="feature"] [class*="title"]'
          );

          // Fallback: look for rows that contain a status badge
          const statusBadges = document.querySelectorAll(
            '[class*="badge"], [class*="status"], [class*="tag"], [class*="pill"]'
          );

          // Try to find feature containers by badge proximity
          const containers = new Set();
          for (const badge of statusBadges) {
            const badgeText = badge.textContent.trim();
            if (!['planned','try now','in development','rolling out','launched'].some(
              s => badgeText.toLowerCase().includes(s)
            )) continue;
            // Walk up to find the row container
            let el = badge.parentElement;
            for (let i = 0; i < 5; i++) {
              if (!el) break;
              const text = el.textContent.trim();
              if (text.length > 20 && text.length < 2000) {
                containers.add(el);
                break;
              }
              el = el.parentElement;
            }
          }

          for (const container of containers) {
            // Extract title — largest/first text node that isn't a badge/date
            const allText = container.innerText || container.textContent || '';
            const lines = allText.split('\n').map(l => l.trim()).filter(Boolean);

            // Title is typically the longest non-date, non-badge line
            const isDate = s => /Q[1-4]\s*\d{4}|CY\d{4}|\d{4}/.test(s);
            const isBadge = s => ['planned','try now','in development','rolling out','launched',
              'public preview','general availability','preview','ga'].includes(s.toLowerCase());

            const titleLine = lines.find(l => l.length > 10 && !isDate(l) && !isBadge(l));
            if (!titleLine) continue;

            // Status
            const statusLine = lines.find(l => isBadge(l));
            const status = statusLine
              ? statusLine.charAt(0).toUpperCase() + statusLine.slice(1).toLowerCase()
              : 'Planned';

            // Dates — look for "Public preview Q1 2026" / "General availability Q1 2026"
            const fullText = allText.toLowerCase();
            const previewMatch = fullText.match(/public preview[:\s]*(q[1-4]\s*\d{4}|\d{4})/i);
            const gaMatch      = fullText.match(/general availability[:\s]*(q[1-4]\s*\d{4}|\d{4})/i);

            // Get URL if there's a link in the container
            const link = container.querySelector('a');
            const url = link ? link.href : '';

            results.push({
              title:       titleLine,
              category:    catName,
              status,
              previewDate: previewMatch ? previewMatch[1].toUpperCase() : '',
              gaDate:      gaMatch      ? gaMatch[1].toUpperCase()      : '',
              url,
            });
          }

          return results;
        }, cat.text);

        console.log(`    → ${features.length} features`);

        for (const f of features) {
          // Avoid duplicates (same title may appear in multiple categories)
          if (!allFeatures.some(x => x.title === f.title && x.category === f.category)) {
            allFeatures.push(f);
          }
        }
      } catch (err) {
        console.warn(`  [WARN] Failed to scrape category "${cat.text}": ${err.message}`);
      }
    }

    // If category-by-category yielded nothing, fall back to full-page scrape
    if (allFeatures.length === 0) {
      console.log('  → Category scrape empty — falling back to full-page extraction…');
      const fallback = await page.evaluate(() => {
        const badges = document.querySelectorAll('*');
        const results = [];
        for (const el of badges) {
          const text = (el.textContent || '').trim();
          if (text === 'Planned' || text === 'Try Now') {
            let row = el.parentElement;
            for (let i = 0; i < 6; i++) {
              if (!row) break;
              const lines = (row.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
              const title = lines.find(l => l.length > 10 &&
                !['planned','try now'].includes(l.toLowerCase()) &&
                !/Q[1-4]\s*\d{4}/.test(l)
              );
              if (title) {
                results.push({ title, category: 'Fabric', status: text, previewDate: '', gaDate: '', url: '' });
                break;
              }
              row = row.parentElement;
            }
          }
        }
        return [...new Map(results.map(r => [r.title, r])).values()];
      });
      allFeatures.push(...fallback);
    }

    console.log(`\n  → Total Fabric Roadmap features: ${allFeatures.length}`);

    // Convert to article format
    const articles = allFeatures.map(f => ({
      title:   f.title,
      summary: [
        f.category ? `Category: ${f.category}` : '',
        f.previewDate ? `Public Preview: ${f.previewDate}` : '',
        f.gaDate      ? `General Availability: ${f.gaDate}` : '',
      ].filter(Boolean).join(' · ') || 'See Microsoft Fabric Roadmap for details.',
      source:  f.category || 'Fabric Roadmap',
      product: 'Fabric',
      status:  f.status,
      url:     f.url || 'https://roadmap.fabric.microsoft.com/',
      date:    new Date().toISOString(),
      previewDate: f.previewDate || undefined,
      gaDate:      f.gaDate      || undefined,
    }));

    return articles;
  } catch (err) {
    console.warn(`  [WARN] Fabric Roadmap scrape failed: ${err.message}`);
    return [];
  } finally {
    await browser.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n=== Roadmap Fetch: ${today} ===`);
  fs.mkdirSync(NEWS_DIR, { recursive: true });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayPath = path.join(NEWS_DIR, `${yesterday.toISOString().slice(0, 10)}.json`);
  const yesterdayUrls = loadUrlSet(yesterdayPath);
  console.log(`  [NEW] Comparing against ${yesterdayUrls.size} articles from yesterday`);

  // Fetch in priority order — release plan last so it can't block main data
  const copilotItems      = await fetchRoadmapTab('copilot');
  await sleep(800);                                 // breathing room between same-URL requests
  const agentsItems       = await fetchRoadmapTab('agents');
  const releaseNotesItems = await fetchReleaseNotes();
  const releasePlan       = await fetchReleasePlan();

  // Merge Release Wave planned features into Release Notes
  // Mark them with planned:true so the UI can show a badge
  for (const item of releasePlan.items) {
    item.planned    = true;
    item.waveLabel  = releasePlan.label;   // e.g. "2026 Release Wave 1"
  }
  const mergedReleaseNotes = [...releaseNotesItems, ...releasePlan.items]
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const fabricItems = await fetchFabricRoadmap();

  const tabs = {
    copilot:       copilotItems,
    agents:        agentsItems,
    releasenotes:  mergedReleaseNotes,
    fabricroadmap: fabricItems,
  };

  // Mark articles new vs. yesterday
  for (const articles of Object.values(tabs)) {
    for (const a of articles) {
      if (a.url && !yesterdayUrls.has(a.url)) a.isNew = true;
    }
  }

  const output = {
    date:       today,
    updated:    new Date().toISOString(),
    wave:       releasePlan.wave,       // e.g. "261"
    waveLabel:  releasePlan.label,      // e.g. "2026 Release Wave 1"
    tabs,
  };

  const outPath = path.join(NEWS_DIR, `${today}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n[OK] Written: ${outPath}`);

  deleteOldFiles();
  updateIndex(today);
  console.log('\n=== Done ===');
  process.exit(0);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
