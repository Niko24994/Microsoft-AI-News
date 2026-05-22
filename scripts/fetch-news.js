import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';

const parser = new Parser({ timeout: 10000 });
const NEWS_DIR = path.resolve('public/news');
const MAX_AGE_DAYS = 180;

const FEEDS = {
  powerplatform: [
    'https://www.microsoft.com/en-us/power-platform/blog/feed/',
    'https://www.microsoft.com/en-us/power-platform/blog/power-automate/feed/',
  ],
  fabric: [
    'https://blog.fabric.microsoft.com/en-us/blog/feed/',
  ],
  powerbi: [
    'https://powerbi.microsoft.com/en-us/blog/feed/',
  ],
  copilot: [
    'https://www.microsoft.com/releasecommunications/api/v2/m365/rss',
  ],
  agents: [
    'https://www.microsoft.com/releasecommunications/api/v2/m365/rss',
  ],
};

// Blog tabs: filter by roadmap keywords in title
const BLOG_TABS = new Set(['powerplatform', 'fabric', 'powerbi']);

const ROADMAP_KEYWORDS = [
  'preview', 'generally available', ' ga ', "what's new", "what's new",
  'feature summary', 'feature update', 'roadmap', 'upcoming', 'retiring',
  'deprecated', 'deprecation', 'release plan', 'public preview', 'private preview',
  'coming soon', 'now available', 'release notes', 'feature release',
  'monthly update', 'desktop update', 'service update',
];

// Category keywords for M365 Roadmap RSS tabs
const ROADMAP_RSS_FILTER = {
  copilot: ['copilot'],
  agents:  ['copilot studio', 'agent'],
};

const STATUS_VALUES = ['In development', 'Rolling out', 'Launched', 'Cancelled'];

// Categories that are NOT product names (platform/availability/region)
const NON_PRODUCT_CATS = new Set([
  ...STATUS_VALUES,
  'Worldwide (Standard Multi-Tenant)', 'GCC', 'GCC High', 'DoD',
  'Web', 'Desktop', 'Mac', 'Android', 'iOS', 'Mobile', 'Developer',
  'Linux', 'Teams and Surface Devices',
  'General Availability', 'Preview', 'Targeted Release', 'Current Channel',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function fetchTab(tab) {
  console.log(`\n[${tab}] Loading feeds…`);
  const urls = FEEDS[tab];
  const isRoadmapRSS = !BLOG_TABS.has(tab);
  const allItems = [];

  for (const url of urls) {
    console.log(`  → ${url}`);
    const items = await fetchFeed(url);
    for (const item of items) {
      const categories = item.categories || [];

      let source, status;
      if (isRoadmapRSS) {
        status = categories.find(c => STATUS_VALUES.includes(c)) || null;
        source = categories.find(c => !NON_PRODUCT_CATS.has(c)) || 'Microsoft 365 Roadmap';
      } else {
        source = item.creator || new URL(url).hostname;
        status = null;
      }

      const entry = {
        title:   (item.title || '').trim(),
        summary: (item.contentSnippet || item.description || item.summary || item.content || '')
          .replace(/<[^>]+>/g, '').trim().slice(0, 500),
        source,
        url:     item.link || item.guid || '',
        date:    item.isoDate || item.pubDate || new Date().toISOString(),
        _categories: categories,
      };
      if (status) entry.status = status;

      allItems.push(entry);
    }
    await sleep(300);
  }

  // Sort newest first
  allItems.sort((a, b) => new Date(b.date) - new Date(a.date));

  let filtered;
  if (BLOG_TABS.has(tab)) {
    filtered = allItems.filter(item => {
      const title = (item.title || '').toLowerCase();
      return ROADMAP_KEYWORDS.some(kw => title.includes(kw));
    });
  } else {
    const keywords = ROADMAP_RSS_FILTER[tab] || [];
    filtered = allItems.filter(item => {
      const catText = item._categories.join(' ').toLowerCase();
      const title   = (item.title || '').toLowerCase();
      return keywords.some(kw => catText.includes(kw) || title.includes(kw));
    });
  }

  // Remove internal field before saving
  const result = filtered.map(({ _categories, ...rest }) => rest);
  console.log(`  → ${result.length} articles selected`);
  return result;
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

  const tabs = {};
  for (const tab of Object.keys(FEEDS)) {
    tabs[tab] = await fetchTab(tab);
    await sleep(500);
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
