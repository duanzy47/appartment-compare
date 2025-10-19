import { chromium, Browser, BrowserContext } from 'playwright';
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

async function main(): Promise<void> {
  const repoRoot = await findRepoRoot(process.cwd());
  const localDir = await ensureLocalDir(repoRoot);
  const storageStatePath = path.resolve(localDir, 'state-seloger.json');

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://www.seloger.com/', { waitUntil: 'networkidle' });
    console.log('Veuillez vous connecter manuellement dans les 60 secondes...');
    await page.waitForTimeout(60_000);
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
