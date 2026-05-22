import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';

const parser = new Parser({ timeout: 10000 });
const NEWS_DIR = path.resolve('public/news');
const MAX_AGE_DAYS = 180;

// Roadmap RSS tabs — real M365 feature pipeline
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

// Release Notes tabs — product blog feeds, each tagged with a product label
const RELEASE_FEEDS = [
  { url: 'https://blog.fabric.microsoft.com/en-us/blog/feed/',                       product: 'Fabric' },
  { url: 'https://powerbi.microsoft.com/en-us/blog/feed/',                           product: 'Power BI' },
  { url: 'https://www.microsoft.com/en-us/power-platform/blog/feed/',                product: 'Power Platform' },
  { url: 'https://www.microsoft.com/en-us/power-platform/blog/power-automate/feed/', product: 'Power Automate' },
  { url: 'https://powerapps.microsoft.com/en-us/blog/feed/',                         product: 'Power Apps' },
];

// Keywords that must appear in title for release notes articles
const RELEASE_KEYWORDS = [
  'preview', 'generally available', ' ga ', "what's new", "what's new",
  'feature summary', 'feature update', 'roadmap', 'upcoming', 'retiring',
  'deprecated', 'deprecation', 'release plan', 'public preview', 'private preview',
  'coming soon', 'now available', 'release notes', 'feature release',
  'monthly update', 'desktop update', 'service update', 'update',
];

const STATUS_VALUES = ['In development', 'Rolling out', 'Launched', 'Cancelled'];

const NON_PRODUCT_CATS = new Set([
  ...STATUS_VALUES,
  'Worldwide (Standard Multi-Tenant)', 'GCC', 'GCC High', 'DoD',
  'Web', 'Desktop', 'Mac', 'Android', 'iOS', 'Mobile', 'Developer',
  'Linux', 'Teams and Surface Devices',
  'General Availability', 'Preview', 'Targeted Release', 'Current Channel',
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Parse "Preview date: June CY2026" and "GA date: July CY2026" from roadmap descriptions
function parseRoadmapDates(text) {
  const t = text || '';
  const MY = '[A-Za-z]+\\s+(?:CY)?20\\d{2}';        // e.g. "June CY2026" or "July 2026"
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

// Fetch one M365 Roadmap RSS tab (copilot or agents)
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
    // Parse Preview / GA dates from description text
    const parsedDates = parseRoadmapDates(summary);
    if (parsedDates.previewDate) entry.previewDate = parsedDates.previewDate;
    if (parsedDates.gaDate)      entry.gaDate      = parsedDates.gaDate;
    result.push(entry);
  }

  result.sort((a, b) => new Date(b.date) - new Date(a.date));
  console.log(`  → ${result.length} items`);
  return result;
}

// Fetch all release notes blogs (combined, tagged by product)
async function fetchReleaseNotes() {
  console.log('\n[releasenotes] Loading blog feeds…');
  const allItems = [];

  for (const { url, product } of RELEASE_FEEDS) {
    console.log(`  → ${url} [${product}]`);
    const items = await fetchFeed(url);
    for (const item of items) {
      const title = (item.title || '').toLowerCase();
      if (!RELEASE_KEYWORDS.some(kw => title.includes(kw))) continue;
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

  // Deduplicate by URL
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

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n=== Roadmap Fetch: ${today} ===`);
  fs.mkdirSync(NEWS_DIR, { recursive: true });

  // Load yesterday's URLs to detect new articles
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayPath = path.join(NEWS_DIR, `${yesterday.toISOString().slice(0, 10)}.json`);
  const yesterdayUrls = loadUrlSet(yesterdayPath);
  console.log(`  [NEW] Comparing against ${yesterdayUrls.size} articles from yesterday`);

  const tabs = {
    copilot:      await fetchRoadmapTab('copilot'),
    agents:       await fetchRoadmapTab('agents'),
    releasenotes: await fetchReleaseNotes(),
  };

  // Mark articles that didn't exist yesterday
  for (const articles of Object.values(tabs)) {
    for (const a of articles) {
      if (a.url && !yesterdayUrls.has(a.url)) a.isNew = true;
    }
  }

  const output = { date: today, updated: new Date().toISOString(), tabs };
  const outPath = path.join(NEWS_DIR, `${today}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n[OK] Written: ${outPath}`);

  deleteOldFiles();
  updateIndex(today);
  console.log('\n=== Done ===');
  process.exit(0);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
