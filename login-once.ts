import { chromium, Browser, BrowserContext } from 'playwright';
import readline from 'node:readline';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';

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
      // ignore and continue walking up
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

async function saveStorageState(context: BrowserContext, outputPath: string): Promise<void> {
  await context.storageState({ path: outputPath });
}

interface CliOptions {
  validateAuth: boolean;
  favoritesUrl: string;
  waitSeconds: number;
}

function parseArgs(argv: string[]): CliOptions {
  let validateAuth = false;
  let favoritesUrl = 'https://www.seloger.com/mes-recherches/favoris';
  let waitSeconds = 60;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--validate-auth') {
      validateAuth = true;
    } else if (arg === '--favorites') {
      const next = argv[i + 1];
      if (!next) throw new Error('--favorites requires a URL');
      favoritesUrl = next;
      i += 1;
    } else if (arg === '--wait') {
      const next = argv[i + 1];
      if (!next) throw new Error('--wait requires seconds');
      const n = Number.parseInt(next, 10);
      if (Number.isNaN(n) || n <= 0) throw new Error('--wait must be a positive integer');
      waitSeconds = n;
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { validateAuth, favoritesUrl, waitSeconds };
}

async function main(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const localDir = await ensureLocalDir(repoRoot);
  const storageStatePath = path.resolve(localDir, 'state-seloger.json');

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    const options = parseArgs(process.argv.slice(2));

    if (process.platform === 'linux' && !process.env.DISPLAY) {
      console.error('GUI display not detected (missing DISPLAY). Please run on a GUI-capable host.');
      process.exit(1);
      return;
    }

    browser = await chromium.launch({ headless: false });
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://www.seloger.com/', { waitUntil: 'networkidle' });

    if (!options.validateAuth) {
      console.log(`Please sign in manually within ${options.waitSeconds} seconds...`);
      await page.waitForTimeout(options.waitSeconds * 1000);
      await saveStorageState(context, storageStatePath);
      console.log('STATE_SAVED: ./local/state-seloger.json');
      return;
    }

    // Validate authentication against favorites page to ensure DataDome is cleared.
    console.log('Manual authentication validation enabled.');
    console.log('1) Sign in on the Seloger website in the opened window.');
    console.log('2) When ready, press Enter here to navigate to your favorites and validate.');

    await new Promise<void>((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Press Enter to navigate to favorites...', () => { rl.close(); resolve(); });
    });

    // Listen for key network signals
    page.on('response', async (resp) => {
      try {
        const url = resp.url();
        const status = resp.status();
        if (/consumer-portal\/v1\/favorites/.test(url)) {
          if (status === 200) {
            console.log('[OK] Favorites API returned 200.');
          } else if (status === 403) {
            console.warn('[WARN] Favorites API returned 403 (DataDome). Solve the challenge in the browser.');
          }
        }
        if (/captcha-delivery\.com|datadome/i.test(url)) {
          console.warn('[INFO] Captcha/DataDome flow detected. Solve it in the browser, then continue.');
        }
      } catch {
        // ignore
      }
    });

    await page.goto(options.favoritesUrl, { waitUntil: 'domcontentloaded' });
    console.log('Validate that your favorites load.');
    console.log('If a captcha appears, complete it in the browser.');
    console.log('When listings are visible, press Enter here to save the authenticated state.');

    await new Promise<void>((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Press Enter to save state...', () => { rl.close(); resolve(); });
    });

    await saveStorageState(context, storageStatePath);
    console.log('STATE_SAVED: ./local/state-seloger.json');
  } catch (error) {
    console.error('Erreur lors de la capture de la session:', error);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
