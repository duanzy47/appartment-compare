import { chromium, BrowserContext, Page, Locator, Frame } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';

interface DelayRange {
  min: number;
  max: number;
}

type ListingRecord = {
  id: string | null;
  url: string;
  标题: string | null;
  价格: number | null;
  每平价: number | null;
  '面积(m²)': number | null;
  房间数: number | null;
  卧室数: number | null;
  楼层: string | null;
  '地址/小区': string | null;
  DPE: string | null;
  GES: string | null;
  '特征(电梯/车位/地窖/阳台等)': string[];
  描述: string | null;
  中介名称: string | null;
  '参考号/Identifiant': string | null;
};

declare global {
  interface Window {
    chrome?: unknown;
  }
  interface Navigator {
    permissions?: { query: (descriptor: unknown) => Promise<{ state: string }> };
  }
}

interface CliOptions {
  urls: string[];
  outPath?: string;
  delayRange: DelayRange;
}

const CONCURRENCY_LIMIT = 3;
const DEFAULT_DELAY_RANGE: DelayRange = { min: 1_000, max: 2_000 };
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

async function findRepoRoot(startDir: string): Promise<string> {
  let currentDir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(currentDir, '.git');
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        return currentDir;
      }
    } catch (error) {
      // ignore and continue upward
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error('Unable to locate repository root (.git directory not found).');
    }
    currentDir = parentDir;
  }
}

async function ensureLocalDir(repoRoot: string): Promise<string> {
  const localDir = path.resolve(repoRoot, 'local');
  await fs.mkdir(localDir, { recursive: true });
  return localDir;
}

async function loadEnvUserAgent(repoRoot: string): Promise<string | undefined> {
  const envPath = path.resolve(repoRoot, '.env');
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const [key, ...rest] = trimmed.split('=');
      if (!key) {
        continue;
      }
      const value = rest.join('=').trim();
      if (key === 'USER_AGENT' && value) {
        return value;
      }
    }
  } catch (error) {
    // ignore missing .env
  }
  return undefined;
}

function parseArgs(argv: string[]): CliOptions {
  const urls: string[] = [];
  let outPath: string | undefined;
  let delayMin = DEFAULT_DELAY_RANGE.min;
  let delayMax = DEFAULT_DELAY_RANGE.max;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('--out requires a path value');
      }
      outPath = next;
      i += 1;
    } else if (arg === '--delay-min') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('--delay-min requires a numeric value');
      }
      delayMin = Number.parseInt(next, 10);
      if (Number.isNaN(delayMin) || delayMin < 0) {
        throw new Error('--delay-min must be a non-negative integer');
      }
      i += 1;
    } else if (arg === '--delay-max') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('--delay-max requires a numeric value');
      }
      delayMax = Number.parseInt(next, 10);
      if (Number.isNaN(delayMax) || delayMax < 0) {
        throw new Error('--delay-max must be a non-negative integer');
      }
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      urls.push(arg);
    }
  }

  if (urls.length === 0) {
    throw new Error('Please provide at least one favorites URL.');
  }

  if (delayMax < delayMin) {
    throw new Error('--delay-max must be greater than or equal to --delay-min');
  }

  return {
    urls,
    outPath,
    delayRange: { min: delayMin, max: delayMax },
  };
}

function randomDelay(range: DelayRange): number {
  if (range.max <= range.min) {
    return range.min;
  }
  const delta = range.max - range.min;
  return range.min + Math.floor(Math.random() * (delta + 1));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseFrenchNumber(text: string | null): number | null {
  if (!text) {
    return null;
  }
  const normalized = text
    .replace(/\u00a0/g, ' ')
    .replace(/[^0-9,\.\-]/g, '')
    .replace(/,/g, '.');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  return Number.parseFloat(match[0]);
}

function parsePrice(text: string | null): number | null {
  const value = parseFrenchNumber(text);
  if (value == null) {
    return null;
  }
  return Math.round(value);
}

function parseArea(text: string | null): number | null {
  return parseFrenchNumber(text);
}

function parseIntegerFromText(text: string | null): number | null {
  if (!text) {
    return null;
  }
  const match = text.replace(/\u00a0/g, ' ').match(/\d+/);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[0], 10);
}

function cleanText(input: string | null): string | null {
  if (!input) {
    return null;
  }
  const normalized = input.replace(/\s+/g, ' ').trim();
  return normalized.length === 0 ? null : normalized;
}

function extractListingId(url: string): string | null {
  const match = url.match(/(\d+)(?:\.htm)?/);
  return match ? match[1] : null;
}

async function textOrNull(locator: Locator): Promise<string | null> {
  try {
    const value = await locator.first().innerText({ timeout: 5_000 }).catch(() => null);
    return cleanText(value);
  } catch (error) {
    return null;
  }
}

async function firstText(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if (await locator.count()) {
      const value = await textOrNull(locator);
      if (value) {
        return value;
      }
    }
  }
  return null;
}

type LocatorScope = Page | Frame;

async function firstVisible(scope: LocatorScope, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = scope.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1_000 })) {
        return locator;
      }
    } catch (error) {
      continue;
    }
  }
  return null;
}

async function waitForFavoritesFrame(page: Page): Promise<Frame | null> {
  const timeoutMs = 30_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const frame of page.frames()) {
      const frameUrl = frame.url();
      if (/mes-favoris|mes-recherches|favoris/i.test(frameUrl)) {
        return frame;
      }
      try {
        const hasFavoritesApp = await frame.evaluate(() => {
          return Boolean(document.querySelector('[data-testid="favorites-list"], [data-testid="fav-listing"], a[href*="/annonces/"]'));
        });
        if (hasFavoritesApp) {
          return frame;
        }
      } catch (error) {
        // ignore cross-origin frames
      }
    }
    await sleep(500);
  }
  return null;
}

async function collectFavoriteLinks(context: BrowserContext, url: string, delayRange: DelayRange): Promise<string[]> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('body', { timeout: 30_000 });
    await acceptCookiesIfPresent(page);

    const favoritesFrame = await waitForFavoritesFrame(page);
    const scopes: LocatorScope[] = favoritesFrame ? [favoritesFrame] : [page];

    const collected = new Set<string>();
    for (const scope of scopes) {
      const links = await collectLinksInScope(scope, delayRange);
      links.forEach((link) => collected.add(link));
    }

    if (collected.size === 0 && !favoritesFrame) {
      // as a fallback, attempt to inspect all child frames
      for (const frame of page.frames()) {
        const links = await collectLinksInScope(frame, delayRange);
        links.forEach((link) => collected.add(link));
      }
    }

    return Array.from(collected);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function collectLinksInScope(scope: LocatorScope, delayRange: DelayRange): Promise<string[]> {
  await scope.waitForSelector('a[href*="/annonces/"]', { timeout: 30_000 }).catch(() => undefined);

  const collected = new Set<string>();
  let previousCount = 0;
  let idleIterations = 0;
  const maxIdleIterations = 6;

  while (idleIterations < maxIdleIterations) {
    const links = await gatherListingLinks(scope);
    for (const link of links) {
      collected.add(link.split('#')[0]);
    }

    const newCount = collected.size;
    if (newCount === previousCount) {
      idleIterations += 1;
    } else {
      idleIterations = 0;
      previousCount = newCount;
    }

    const loadMoreButton = await firstVisible(scope, [
      'button:has-text("Afficher plus")',
      'button:has-text("Voir plus")',
      'button:has-text("Charger plus")',
      'button[data-testid="sl-load-more"]',
    ]);

    if (loadMoreButton) {
      await loadMoreButton.click().catch(() => undefined);
      await waitForNetworkIdle(scope);
      await sleep(randomDelay(delayRange));
      continue;
    }

    await scope.evaluate(() => {
      const scrollingElement = document.scrollingElement || document.documentElement || document.body;
      const currentTop = scrollingElement.scrollTop;
      const nextTop = Math.min(scrollingElement.scrollHeight, currentTop + scrollingElement.clientHeight * 0.9);
      scrollingElement.scrollTo({ top: nextTop, behavior: 'smooth' });
    }).catch(() => undefined);

    await sleep(randomDelay(delayRange));
    await waitForNetworkIdle(scope);
  }

  return Array.from(collected);
}

async function gatherListingLinks(scope: LocatorScope): Promise<string[]> {
  try {
    return await scope.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/annonces/"]'));
      return anchors.map((anchor) => anchor.href);
    });
  } catch (error) {
    return [];
  }
}

async function waitForNetworkIdle(scope: LocatorScope): Promise<void> {
  if ('waitForLoadState' in scope) {
    await scope.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  }
}

async function acceptCookiesIfPresent(page: Page): Promise<void> {
  const selectors = [
    'button:has-text("Tout accepter")',
    'button:has-text("Accepter")',
    '#didomi-notice-agree-button',
    'button[data-testid="accept-cookies"]'
  ];
  const consentButton = await firstVisible(page, selectors);
  if (consentButton) {
    await consentButton.click().catch(() => undefined);
    await waitForNetworkIdle(page);
  }
}

async function applyStealth(context: BrowserContext, userAgent: string): Promise<void> {
  await context.addInitScript(({ ua }) => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    } catch (error) {
      /* noop */
    }
    window.chrome = window.chrome ?? { runtime: {} };
    if (!('permissions' in navigator)) {
      (navigator as any).permissions = { query: () => Promise.resolve({ state: 'granted' }) };
    }
    try {
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      Object.defineProperty(navigator, 'language', { get: () => 'fr-FR' });
      Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'userAgent', { get: () => ua });
    } catch (error) {
      /* noop */
    }
  }, { ua: userAgent });
  context.setDefaultTimeout(60_000);
}

async function getSectionTexts(page: Page, headingTexts: string[]): Promise<string[]> {
  for (const heading of headingTexts) {
    const section = page.locator(`section:has(h2:has-text("${heading}"))`);
    if (await section.count()) {
      const items = await section.locator('li').allInnerTexts();
      if (items.length > 0) {
        return items.map((item) => cleanText(item)).filter((item): item is string => Boolean(item));
      }
    }
  }
  return [];
}

async function extractDescription(page: Page): Promise<string | null> {
  const section = page.locator('section:has(h2:has-text("Description"))');
  if (await section.count()) {
    const body = await section.locator('p').allInnerTexts();
    if (body.length) {
      return cleanText(body.join('\n'));
    }
  }
  const alt = await page.locator('[data-testid="sl-description"]').first().textContent().catch(() => null);
  return cleanText(alt);
}

async function extractPerformance(page: Page): Promise<{ dpe: string | null; ges: string | null }> {
  const section = page.locator('section:has(h2:has-text("Performance énergétique"))');
  if (await section.count()) {
    const sectionText = await section.first().innerText();
    const dpeMatch = sectionText.match(/DPE\s*:?\s*([A-G]\s*\d+|[A-G])/i);
    const gesMatch = sectionText.match(/GES\s*:?\s*([A-G]\s*\d+|[A-G])/i);
    return {
      dpe: dpeMatch ? cleanText(dpeMatch[1]) : null,
      ges: gesMatch ? cleanText(gesMatch[1]) : null,
    };
  }

  const bodyText = await page.locator('body').innerText();
  const dpeMatch = bodyText.match(/DPE\s*:?\s*([A-G]\s*\d+|[A-G])/i);
  const gesMatch = bodyText.match(/GES\s*:?\s*([A-G]\s*\d+|[A-G])/i);
  return {
    dpe: dpeMatch ? cleanText(dpeMatch[1]) : null,
    ges: gesMatch ? cleanText(gesMatch[1]) : null,
  };
}

async function extractLabelValue(page: Page, labels: RegExp[]): Promise<string | null> {
  const data = await page.evaluate((patterns: string[]) => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('dt, strong, span, div')); // broad search
    for (const element of elements) {
      const text = element.textContent?.trim() ?? '';
      if (!text) {
        continue;
      }
      if (patterns.some((pattern) => new RegExp(pattern, 'i').test(text))) {
        const sibling = element.nextElementSibling as HTMLElement | null;
        if (sibling && sibling.textContent) {
          return sibling.textContent.trim();
        }
        if (element.parentElement && element.parentElement !== document.body) {
          const parentText = element.parentElement.textContent?.trim();
          if (parentText && parentText !== text) {
            return parentText.replace(text, '').trim();
          }
        }
      }
    }
    return null;
  }, labels.map((label) => label.source));

  return cleanText(data);
}

async function extractListing(page: Page, url: string): Promise<ListingRecord> {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('main, #app', { timeout: 30_000 });

  const title = await textOrNull(page.locator('h1'));
  const priceText = await firstText(page, [
    '[data-testid="sl-price"]',
    '[data-test="price"]',
    '[itemprop="price"]',
    'span:has-text("€")',
    'text=/€/'
  ]);
  const price = parsePrice(priceText);

  const pricePerSqmText = await firstText(page, [
    'text=/€\s*\/\s*m²/i',
    'text=/€/m²/i',
  ]);
  const pricePerSqm = parsePrice(pricePerSqmText);

  const areaText = await firstText(page, ['text=/\d+[\s\u00a0]*m²/i']);
  const area = parseArea(areaText);

  const roomsText = await firstText(page, ['text=/\d+\s*pi[èe]ce/i']);
  const bedroomsText = await firstText(page, ['text=/\d+\s*chambre/i']);
  const rooms = parseIntegerFromText(roomsText);
  const bedrooms = parseIntegerFromText(bedroomsText);

  const floor = await extractLabelValue(page, [/Étages?/, /Niveau/, /Étage/]);
  const address = await textOrNull(page.locator('address'))
    ?? await textOrNull(page.locator('section:has(h2:has-text("Localisation")) p'))
    ?? await extractLabelValue(page, [/Adresse/, /Quartier/]);

  const performance = await extractPerformance(page);

  const featuresRaw = await getSectionTexts(page, ['Caractéristiques', 'Équipements']);
  const features = featuresRaw.map((item) => item ?? '').filter((item) => item.length > 0);

  const description = await extractDescription(page);

  const agency = await textOrNull(page.locator('section:has(h2:has-text("Contact")) h3'))
    ?? await textOrNull(page.locator('section:has(h2:has-text("Agence")) h3'))
    ?? await extractLabelValue(page, [/Agence/, /Contact/]);

  const reference = await extractLabelValue(page, [/Référence/, /Identifiant/]);

  return {
    id: extractListingId(url),
    url,
    标题: title,
    价格: price,
    每平价: pricePerSqm,
    '面积(m²)': area,
    房间数: rooms,
    卧室数: bedrooms,
    楼层: cleanText(floor),
    '地址/小区': cleanText(address),
    DPE: performance.dpe,
    GES: performance.ges,
    '特征(电梯/车位/地窖/阳台等)': features,
    描述: description,
    中介名称: cleanText(agency),
    '参考号/Identifiant': cleanText(reference),
  };
}

async function writeOutputs(records: ListingRecord[], localDir: string, customOutPath?: string): Promise<void> {
  const jsonDefaultPath = path.resolve(localDir, 'output.json');
  const csvDefaultPath = path.resolve(localDir, 'output.csv');

  const jsonContent = JSON.stringify(records, null, 2);
  const csvContent = toCsv(records);

  await fs.writeFile(jsonDefaultPath, jsonContent, 'utf8');
  await fs.writeFile(csvDefaultPath, csvContent, 'utf8');

  if (customOutPath) {
    await fs.mkdir(path.dirname(customOutPath), { recursive: true });
    await fs.writeFile(customOutPath, jsonContent, 'utf8');
  }
}

function csvEscape(value: string): string {
  const needsQuotes = /[",\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function toCsv(records: ListingRecord[]): string {
  const headers: (keyof ListingRecord)[] = [
    'id',
    'url',
    '标题',
    '价格',
    '每平价',
    '面积(m²)',
    '房间数',
    '卧室数',
    '楼层',
    '地址/小区',
    'DPE',
    'GES',
    '特征(电梯/车位/地窖/阳台等)',
    '描述',
    '中介名称',
    '参考号/Identifiant',
  ];

  const lines = [headers.join(',')];
  for (const record of records) {
    const row = headers.map((header) => {
      const value = record[header];
      if (Array.isArray(value)) {
        return csvEscape(value.join('; '));
      }
      if (value === null || value === undefined) {
        return '';
      }
      return csvEscape(String(value));
    });
    lines.push(row.join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function logError(errorsPath: string, message: string, error: unknown): Promise<void> {
  const timestamp = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const fullMessage = `[${timestamp}] ${message} :: ${errorMessage}\n`;
  await fs.appendFile(errorsPath, fullMessage, 'utf8');
}

async function processListings(urls: string[], context: BrowserContext, delayRange: DelayRange, errorsPath: string): Promise<ListingRecord[]> {
  const tasks = urls.map((url) => ({ url }));
  const results: (ListingRecord | null)[] = new Array(tasks.length).fill(null);
  let index = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= tasks.length) {
        break;
      }
      const targetUrl = tasks[currentIndex].url;
      const page = await context.newPage();
      try {
        await sleep(randomDelay(delayRange));
        const record = await extractListing(page, targetUrl);
        results[currentIndex] = record;
      } catch (error) {
        await logError(errorsPath, `Failed to scrape ${targetUrl}`, error);
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY_LIMIT, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results.filter((record): record is ListingRecord => record !== null);
}

async function main(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const localDir = await ensureLocalDir(repoRoot);
  const errorsPath = path.resolve(localDir, 'errors.log');

  const statePath = path.resolve(localDir, 'state-seloger.json');
  try {
    await fs.access(statePath);
  } catch (error) {
    console.error('Storage state not found. Please run login-once.ts first.');
    process.exit(1);
    return;
  }

  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
    return;
  }

  const outPathResolved = options.outPath
    ? path.isAbsolute(options.outPath)
      ? options.outPath
      : path.resolve(repoRoot, options.outPath)
    : undefined;

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  let context: BrowserContext | null = null;

  const userAgent = (await loadEnvUserAgent(repoRoot)) ?? DEFAULT_USER_AGENT;

  try {
    context = await browser.newContext({
      storageState: statePath,
      userAgent,
      viewport: { width: 1365, height: 768 },
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      javaScriptEnabled: true,
      extraHTTPHeaders: {
        'sec-ch-ua': '"Google Chrome";v="123", "Chromium";v="123", "Not-A.Brand";v="99"',
        'sec-ch-ua-platform': '"Windows"',
        'sec-ch-ua-mobile': '?0',
        'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    await applyStealth(context, userAgent);

    await fs.writeFile(errorsPath, '', 'utf8');

    const uniqueListingLinks = new Set<string>();
    for (const favoritesUrl of options.urls) {
      const links = await collectFavoriteLinks(context, favoritesUrl, options.delayRange);
      links.forEach((link) => uniqueListingLinks.add(link));
    }

    if (uniqueListingLinks.size === 0) {
      console.warn('No listings found in the provided favorites URLs.');
    }

    const listings = await processListings(Array.from(uniqueListingLinks), context, options.delayRange, errorsPath);
    await writeOutputs(listings, localDir, outPathResolved);

    console.log(`Scraped ${listings.length} listing(s). JSON: ${path.relative(repoRoot, path.resolve(localDir, 'output.json'))}`);
  } catch (error) {
    console.error('Scraping failed:', error);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
