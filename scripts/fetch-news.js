import Parser from 'rss-parser';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const parser = new Parser({ timeout: 10000 });
const NEWS_DIR = path.resolve('public/news');
const MAX_AGE_DAYS = 180;

// Blog-based tabs: product blog RSS feeds
// Roadmap-based tabs: official M365 Roadmap RSS (real feature pipeline)
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

// Blog tabs use keyword filter on title
const BLOG_TABS = new Set(['powerplatform', 'fabric', 'powerbi']);

// Keywords that MUST appear in title for blog-based tabs
const ROADMAP_KEYWORDS = [
  'preview', 'generally available', ' ga ', "what's new", "what's new",
  'feature summary', 'feature update', 'roadmap', 'upcoming', 'retiring',
  'deprecated', 'deprecation', 'release plan', 'public preview', 'private preview',
  'coming soon', 'now available', 'release notes', 'feature release',
  'monthly update', 'desktop update', 'service update',
];

// Category/title keywords for M365 Roadmap RSS tabs
const ROADMAP_RSS_FILTER = {
  copilot: ['copilot'],
  agents:  ['copilot studio', 'agent'],
};

// Status values in M365 Roadmap RSS categories
const STATUS_VALUES = ['In development', 'Rolling out', 'Launched', 'Cancelled'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFeed(url) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout nach 8s')), 8000)
  );
  try {
    const feed = await Promise.race([parser.parseURL(url), timeout]);
    return feed.items || [];
  } catch (err) {
    console.warn(`  [WARN] Feed nicht erreichbar: ${url} — ${err.message}`);
    return [];
  }
}

async function fetchTab(tab) {
  console.log(`\n[${tab}] Lade Feeds…`);
  const urls = FEEDS[tab];
  const isRoadmapRSS = !BLOG_TABS.has(tab);
  const allItems = [];

  for (const url of urls) {
    console.log(`  → ${url}`);
    const items = await fetchFeed(url);
    for (const item of items) {
      const categories = item.categories || [];

      // For M365 Roadmap RSS: show status (e.g. "In development") as source
      let source;
      if (isRoadmapRSS) {
        source = categories.find(c => STATUS_VALUES.includes(c)) || 'Microsoft Roadmap';
      } else {
        source = item.creator || new URL(url).hostname;
      }

      allItems.push({
        title: (item.title || '').trim(),
        summary: (item.contentSnippet || item.description || item.summary || item.content || '')
          .replace(/<[^>]+>/g, '').trim().slice(0, 400),
        source,
        url: item.link || item.guid || '',
        date: item.isoDate || item.pubDate || new Date().toISOString(),
        _categories: categories,
      });
    }
    await sleep(500);
  }

  // Sort: newest first
  allItems.sort((a, b) => new Date(b.date) - new Date(a.date));

  let filtered;
  if (BLOG_TABS.has(tab)) {
    // Blog tabs: only roadmap-relevant articles by title keyword
    filtered = allItems.filter(item => {
      const title = (item.title || '').toLowerCase();
      return ROADMAP_KEYWORDS.some(kw => title.includes(kw));
    });
  } else {
    // M365 Roadmap RSS tabs: filter by category or title keywords
    const keywords = ROADMAP_RSS_FILTER[tab] || [];
    filtered = allItems.filter(item => {
      const catText = item._categories.join(' ').toLowerCase();
      const title = (item.title || '').toLowerCase();
      return keywords.some(kw => catText.includes(kw) || title.includes(kw));
    });
  }

  const top = filtered.slice(0, 10).map(({ _categories, ...rest }) => rest);
  console.log(`  → ${top.length} Artikel ausgewählt`);
  return top;
}

async function translateText(text) {
  if (!text) return text;
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|de`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      return data.responseData.translatedText;
    }
    return text;
  } catch (err) {
    console.warn(`  [WARN] MyMemory Fehler: ${err.message}`);
    return text;
  }
}

async function translateArticles(articles) {
  if (articles.length === 0) return articles;
  console.log(`  → Übersetze ${articles.length} Titel via MyMemory…`);

  const results = [];
  for (const article of articles) {
    const title = await translateText(article.title);
    await sleep(500);
    results.push({ ...article, title });
  }
  return results;
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
    const fileDate = new Date(match[1]);
    if (fileDate < cutoff) {
      fs.unlinkSync(path.join(NEWS_DIR, file));
      console.log(`  [ARCHIV] Gelöscht: ${file}`);
      deleted++;
    }
  }
  if (deleted === 0) console.log('  [ARCHIV] Keine alten Dateien zum Löschen');
}

function updateIndex(today) {
  const files = fs.readdirSync(NEWS_DIR);
  const dates = files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace('.json', ''))
    .sort((a, b) => b.localeCompare(a));

  const index = { latest: today, dates };
  fs.writeFileSync(path.join(NEWS_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`\n[INDEX] ${dates.length} Tage verfügbar, neuestes Datum: ${today}`);
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n=== Roadmap Fetch: ${today} ===`);

  fs.mkdirSync(NEWS_DIR, { recursive: true });

  const tabs = {};
  for (const tab of Object.keys(FEEDS)) {
    const raw = await fetchTab(tab);
    tabs[tab] = await translateArticles(raw);
    await sleep(1000);
  }

  const output = {
    date: today,
    updated: new Date().toISOString(),
    tabs,
  };

  const outPath = path.join(NEWS_DIR, `${today}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n[OK] Geschrieben: ${outPath}`);

  deleteOldFiles();
  updateIndex(today);

  console.log('\n=== Fertig ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fehler:', err);
  process.exit(1);
});
