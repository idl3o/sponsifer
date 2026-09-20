/**
 * Browser play test.
 *
 * Walks the app the way a creator would on their first visit, captures every
 * console error and unhandled rejection, screenshots each tab at desktop and
 * phone widths, and checks for the layout faults that unit tests cannot see:
 * horizontal overflow, invisible text, controls too small to tap.
 *
 * Usage: node scripts/playtest.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const SHOTS = process.env.PLAYTEST_OUT ?? join(process.cwd(), 'playtest-shots');
const TABS = ['Profile', 'Rate card', 'An offer', 'Media kit', 'Prospects', 'Outreach', 'Deals', 'Shop board'];

const problems = [];
const note = (severity, where, message) => problems.push({ severity, where, message });

/** Attach console and error listeners that record rather than print. */
function watch(page, label) {
  page.on('console', (msg) => {
    // The app asks for a workspace file, and for a deal's on-air log, before
    // either exists, and the browser logs those 404s. They mean "not yet",
    // not a fault.
    const expected404 = /404/.test(msg.text()) && /api\/(workspace|onair)/.test(msg.location()?.url ?? '');
    if (msg.type() === 'error' && !expected404) note('error', label, `console: ${msg.text().slice(0, 200)}`);
    if (msg.type() === 'warning' && /React|key|validate/i.test(msg.text())) {
      note('warning', label, `console: ${msg.text().slice(0, 200)}`);
    }
  });
  page.on('pageerror', (err) => note('error', label, `uncaught: ${err.message.slice(0, 200)}`));
  page.on('requestfailed', (req) => {
    // The Ollama probe is expected to fail when Ollama is not running.
    if (req.url().includes('11434')) return;
    // A poll still in flight when the page closes is aborted, which is not a fault.
    if (req.failure()?.errorText === 'net::ERR_ABORTED') return;
    note('warning', label, `request failed: ${req.url().slice(0, 120)}`);
  });
}

/** Fail the page if anything makes the body scroll sideways. */
async function checkOverflow(page, where) {
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    if (d.scrollWidth <= d.clientWidth + 1) return null;
    const offenders = [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > d.clientWidth + 1)
      .slice(0, 4)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)}`);
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, offenders };
  });
  if (overflow) {
    note(
      'error',
      where,
      `horizontal overflow ${overflow.scrollWidth}px in ${overflow.clientWidth}px: ${overflow.offenders.join(', ')}`,
    );
  }
}

/** Check that no interactive control is too small to hit on a phone. */
async function checkTapTargets(page, where) {
  const small = await page.evaluate(() => {
    // A control wrapped in a label is hit by tapping the label, so measure that.
    const box = (el) => (el.closest('label') ?? el).getBoundingClientRect();
    return [...document.querySelectorAll('button, select, input, a')]
      .filter((el) => {
        const r = box(el);
        return r.width > 0 && r.height > 0 && r.height < 28;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 24)}"`);
  });
  if (small.length > 0) note('warning', where, `tap targets under 28px: ${small.join(', ')}`);
}

/** Check every rendered price looks like money rather than NaN or Infinity. */
async function checkNumbers(page, where) {
  const bad = await page.evaluate(() => {
    const text = document.body.innerText;
    const hits = [];
    if (/NaN/.test(text)) hits.push('NaN on screen');
    if (/Infinity/.test(text)) hits.push('Infinity on screen');
    if (/£-/.test(text)) hits.push('negative price');
    if (/undefined/.test(text)) hits.push('undefined on screen');
    return hits;
  });
  for (const hit of bad) note('error', where, hit);
}

async function sweep(page, label, shotPrefix) {
  for (const tab of TABS) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(180);
    const where = `${label}/${tab}`;
    await checkOverflow(page, where);
    await checkNumbers(page, where);
    if (label === 'phone') await checkTapTargets(page, where);
    await page.screenshot({
      path: join(SHOTS, `${shotPrefix}-${tab.toLowerCase().replace(/ /g, '-')}.png`),
      fullPage: true,
    });
  }
}

/**
 * The overlay OBS would load for a won deal.
 *
 * It only draws when a server owns the workspace file, so against a bare
 * `npm run dev` this reports that it was skipped rather than failing.
 */
async function checkOverlay(page, context, dealId) {
  const served = await page.getByText('Saved to the workspace file').isVisible().catch(() => false);
  if (!served || !dealId) {
    note('warning', 'desktop/overlay', served ? 'no deal id to check the overlay with' : 'skipped: no workspace server, run `npm run dev:api`');
    return;
  }
  const overlay = await context.newPage();
  watch(overlay, 'overlay');
  await overlay.setViewportSize({ width: 1280, height: 720 });
  await overlay.goto(`${BASE}/overlay.html?deal=${dealId}`);
  const badge = overlay.locator('.ad-badge');
  const drawn = await badge.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  if (!drawn) {
    note('error', 'desktop/overlay', `no badge drawn for ${dealId}`);
  } else {
    const text = await badge.innerText();
    if (!/^Ad\b/i.test(text)) note('error', 'desktop/overlay', `overlay draws no ad label: ${text}`);
    if (/£|\d{3,}/.test(text)) note('error', 'desktop/overlay', `overlay carries a number that could be a price: ${text}`);
  }
  const body = await overlay.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (body !== 'rgba(0, 0, 0, 0)') note('error', 'desktop/overlay', `overlay page is not transparent: ${body}`);
  await overlay.screenshot({ path: join(SHOTS, 'obs-overlay.png'), omitBackground: true });
  await overlay.close();
}

/** Type a nano creator's real numbers into the profile. */
async function becomeNanoCreator(page) {
  await page.getByRole('tab', { name: 'Profile' }).click();
  await page.getByLabel('Median views per post').first().fill('900');
  await page.getByLabel('Followers or subscribers').first().fill('4000');
  await page.getByLabel('Name').fill('Nano Creator');
  await page.waitForTimeout(200);
}

const run = async () => {
  mkdirSync(SHOTS, { recursive: true });
  // Use the Chrome already on this machine rather than downloading a build.
  const browser = await chromium.launch({ channel: 'chrome' });

  // --- desktop, sample data ---
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page, 'desktop');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await sweep(page, 'desktop', 'desktop');

  // --- the case that was broken: a very small creator ---
  await becomeNanoCreator(page);
  await page.getByRole('tab', { name: 'Rate card' }).click();
  await page.waitForTimeout(250);

  const nanoPrice = await page.locator('.price').first().innerText();
  const flooredPill = await page.getByText('priced on your time').first().isVisible().catch(() => false);
  if (!flooredPill) {
    note('error', 'desktop/nano', 'production floor not surfaced for a 900-view creator');
  }
  const nanoValue = Number(nanoPrice.replace(/[£,]/g, ''));
  if (!Number.isFinite(nanoValue) || nanoValue < 100) {
    note('error', 'desktop/nano', `nano creator quoted ${nanoPrice}, which is below the cost of the work`);
  }
  await page.screenshot({ path: join(SHOTS, 'nano-rate-card.png'), fullPage: true });

  // Expand a derivation and confirm the reasoning renders.
  await page.locator('.rate-head').first().click();
  await page.waitForTimeout(150);
  const derivation = await page.locator('.rate-body').first().innerText();
  for (const required of ['Audience value', 'Cost of making it', 'Asking price']) {
    if (!derivation.includes(required)) {
      note('error', 'desktop/derivation', `derivation missing "${required}"`);
    }
  }
  await page.screenshot({ path: join(SHOTS, 'nano-derivation.png'), fullPage: true });

  // --- terms actually move the price ---
  const before = await page.locator('.price').first().innerText();
  await page.getByLabel('Usage rights').selectOption('full-buyout');
  await page.waitForTimeout(200);
  const after = await page.locator('.price').first().innerText();
  if (before === after) note('error', 'desktop/terms', 'full buyout did not change the price');
  await page.getByLabel('Usage rights').selectOption('organic-only');

  // --- outreach draft ---
  await page.getByRole('tab', { name: 'Outreach' }).click();
  await page.waitForTimeout(300);
  const email = await page.locator('.email').first().innerText();
  if (!email.includes('£')) note('error', 'desktop/outreach', 'draft contains no price');
  if (email.length < 200) note('error', 'desktop/outreach', 'draft suspiciously short');
  if (/\bundefined\b|\bNaN\b/.test(email)) note('error', 'desktop/outreach', 'draft contains a broken merge field');
  await page.screenshot({ path: join(SHOTS, 'outreach-draft.png'), fullPage: true });

  // --- deal log: record a win, then a sighting that overran its licence ---
  await page.getByRole('tab', { name: 'Rate card' }).click();
  await page.getByLabel('Usage rights').selectOption('whitelisting-30');
  if ((await page.getByLabel("Sponsor's declared paid spend, GBP").count()) === 0) {
    note('error', 'desktop/terms', 'declared spend field missing once paid usage is on');
  }
  await page.getByRole('tab', { name: 'Deals' }).click();
  await page.getByLabel('Agreed, GBP').fill('800');
  await page.getByRole('button', { name: 'Record' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Delivery, rights and sightings' }).first().click();
  const rights = await page.locator('main').innerText();
  if (!/sponsifer seal dl-\d+/.test(rights)) {
    note('error', 'desktop/deals', 'unsealed won deal does not say how to seal it');
  }
  await page.getByLabel('Started running').fill('2026-10-01');
  await page.getByLabel('Last seen running').fill('2026-12-15');
  await page.getByRole('button', { name: 'Record sighting' }).click();
  await page.waitForTimeout(200);
  const overrun = await page.locator('main').innerText();
  if (!/75 days in all/.test(overrun) || !/£[\d,]+ in total/.test(overrun)) {
    note('error', 'desktop/deals', 'overrun paragraph missing or unpriced');
  }
  if (!/not verified/.test(overrun)) note('error', 'desktop/deals', 'manual sighting not marked unverified');
  const href = (await page.getByRole('link', { name: 'Submit this rate anonymously' }).getAttribute('href')) ?? '';
  if (!href.includes('template=rate-data.yml') || /Hetzner|Linear/.test(decodeURIComponent(href))) {
    note('error', 'desktop/deals', `rate submission link is wrong or names the brand: ${href.slice(0, 120)}`);
  }
  await checkNumbers(page, 'desktop/deals');
  await page.screenshot({ path: join(SHOTS, 'deals-overrun.png'), fullPage: true });

  // --- the OBS overlay, if this run is against the server that owns the file ---
  await checkOverlay(page, desktop, (rights.match(/sponsifer seal (dl-\d+)/) ?? [])[1]);
  await page.getByRole('tab', { name: 'Rate card' }).click();
  await page.getByLabel('Usage rights').selectOption('organic-only');

  // --- the paid-market reference, on a channel the evidence covers ---
  await page.getByRole('tab', { name: 'Profile' }).click();
  await page.getByRole('button', { name: 'Instagram' }).click();
  await page.getByLabel('Followers or subscribers').last().fill('80000');
  await page.getByLabel('Median views per post').last().fill('20000');
  await page.getByRole('tab', { name: 'Rate card' }).click();
  await page.waitForTimeout(200);
  if (!(await page.getByText(/market pays ~£[\d,]+/).first().isVisible().catch(() => false))) {
    note('error', 'desktop/market', 'no market reference for an 80k-follower Instagram channel');
  }
  await page.getByText(/market pays ~£/).first().click();
  await page.waitForTimeout(150);
  if (!/Smith 2026/.test(await page.locator('main').innerText())) {
    note('error', 'desktop/market', 'market reference does not name its source');
  }
  await page.screenshot({ path: join(SHOTS, 'market-reference.png'), fullPage: true });

  // --- empty state: delete every channel ---
  await page.getByRole('tab', { name: 'Profile' }).click();
  await page.waitForTimeout(150);
  // Channel cards carry a Remove button, and so do proof points. Target only
  // the channel cards, re-querying each time because the list re-renders.
  for (let i = 0; i < 12; i += 1) {
    const remove = page
      .locator('.card')
      .filter({ has: page.getByLabel('Median views per post') })
      .first()
      .getByRole('button', { name: 'Remove' });
    if ((await remove.count()) === 0) break;
    await remove.click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(200);
  await page.getByRole('tab', { name: 'Rate card' }).click();
  await page.waitForTimeout(200);
  const emptyText = await page.locator('main').innerText();
  if (!/No priced placements/i.test(emptyText)) {
    note('error', 'desktop/empty', 'no empty state after removing every channel');
  }
  await checkNumbers(page, 'desktop/empty');
  await page.screenshot({ path: join(SHOTS, 'empty-state.png'), fullPage: true });

  // Outreach with nothing priced must not explode.
  await page.getByRole('tab', { name: 'Outreach' }).click();
  await page.waitForTimeout(250);
  await checkNumbers(page, 'desktop/empty-outreach');
  await page.screenshot({ path: join(SHOTS, 'empty-outreach.png'), fullPage: true });

  await desktop.close();

  // --- phone, fresh storage ---
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const mobile = await phone.newPage();
  watch(mobile, 'phone');
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await sweep(mobile, 'phone', 'phone');
  await phone.close();

  await browser.close();

  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');

  console.log(`\nScreenshots: ${SHOTS}`);
  console.log(`Errors: ${errors.length}   Warnings: ${warnings.length}\n`);
  for (const p of [...errors, ...warnings]) {
    console.log(`  [${p.severity}] ${p.where}: ${p.message}`);
  }
  if (errors.length === 0 && warnings.length === 0) console.log('  nothing found');
  console.log('');
  process.exit(errors.length > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error('play test crashed:', err);
  process.exit(2);
});
