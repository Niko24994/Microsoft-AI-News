import Parser from 'rss-parser';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const parser = new Parser({ timeout: 10000 });
const NEWS_DIR = path.resolve('public/news');
const MAX_ARTICLES_PER_TAB = 5;
const MAX_AGE_DAYS = 180;

const FEEDS = {
  fabric: [
    'https://powerbi.microsoft.com/en-us/blog/feed/',
    'https://blog.fabric.microsoft.com/en-us/blog/feed/',
    'https://www.microsoft.com/en-us/power-platform/blog/feed/',
    'https://www.microsoft.com/en-us/power-platform/blog/power-automate/feed/',
    'https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?board=MicrosoftPowerPlatformBlog',
    'https://www.microsoft.com/en-us/microsoft-365/blog/feed/',
    'https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?board=MicrosoftCopilotBlog',
  ],
  ai: [
    'https://www.anthropic.com/rss.xml',
    'https://openai.com/blog/rss.xml',
    'https://github.blog/feed/',
    'https://huggingface.co/blog/feed.xml',
  ],
  usecase: [
    'https://customers.microsoft.com/en-us/feed',
    'https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?board=MicrosoftDataandAIBlog',
    'https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/custom-blog-rss?board=MicrosoftCopilotBlog',
  ],
};

// Priority keywords for fabric and usecase tabs
const PRIORITY_KEYWORDS = {
  fabric: [
    'copilot studio', 'microsoft 365 copilot', 'copilot in power bi', 'copilot in fabric',
    'autonomous agent', 'ai builder', 'power platform', 'fabric', 'power bi', 'sql',
    'dataflow', 'pipeline', 'lakehouse', 'synapse',
  ],
  usecase: [
    'copilot studio', 'autonomous agent', 'ai builder', 'power platform', 'fabric',
    'power bi', 'energy', 'utility', 'versorger', 'netzbetreiber', 'industrial',
    'manufacturing', 'use case', 'customer story',
  ],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFeed(url) {
  try {
    const feed = await parser.parseURL(url);
    return feed.items || [];
  } catch (err) {
    console.warn(`  [WARN] Feed nicht erreichbar: ${url} — ${err.message}`);
    return [];
  }
}

function scoreArticle(item, tab) {
  const keywords = PRIORITY_KEYWORDS[tab];
  if (!keywords) return 0;
  const text = `${item.title || ''} ${item.contentSnippet || item.content || ''}`.toLowerCase();
  return keywords.reduce((score, kw) => (text.includes(kw) ? score + 1 : score), 0);
}

async function fetchTab(tab) {
  console.log(`\n[${tab}] Lade Feeds…`);
  const urls = FEEDS[tab];
  const allItems = [];

  for (const url of urls) {
    console.log(`  → ${url}`);
    const items = await fetchFeed(url);
    for (const item of items) {
      allItems.push({
        title: (item.title || '').trim(),
        summary: (item.contentSnippet || item.summary || item.content || '').replace(/<[^>]+>/g, '').trim().slice(0, 400),
        source: item.creator || new URL(url).hostname,
        url: item.link || item.guid || '',
        date: item.isoDate || item.pubDate || new Date().toISOString(),
        _score: scoreArticle(item, tab),
      });
    }
    await sleep(500);
  }

  // Sort: priority score desc, then date desc
  allItems.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return new Date(b.date) - new Date(a.date);
  });

  const top = allItems.slice(0, MAX_ARTICLES_PER_TAB).map(({ _score, ...rest }) => rest);
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
  console.log(`  → Übersetze ${articles.length} Artikel via MyMemory…`);

  const results = [];
  for (const article of articles) {
    const title   = await translateText(article.title);
    await sleep(400);
    const summary = await translateText(article.summary);
    await sleep(400);
    results.push({ ...article, title, summary });
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
  console.log(`\n=== News Fetch: ${today} ===`);

  fs.mkdirSync(NEWS_DIR, { recursive: true });

  const tabs = {};
  for (const tab of Object.keys(FEEDS)) {
    const raw = await fetchTab(tab);
    tabs[tab] = await translateArticles(raw);
    await sleep(1000); // Rate-Limit-Pause zwischen Tabs
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
}

main().catch((err) => {
  console.error('Fehler:', err);
  process.exit(1);
});
