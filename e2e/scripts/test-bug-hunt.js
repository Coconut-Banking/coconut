/**
 * Ad-hoc bug hunt. Run from project root: node e2e/scripts/test-bug-hunt.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BUG_REPORT = path.join(process.cwd(), 'BUG_REPORT.md');

async function testCoconutApp() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  const bugs = [];

  fs.mkdirSync(path.join(process.cwd(), 'screenshots'), { recursive: true });

  try {
    await page.goto('http://localhost:3000/app/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/settings-initial.png', fullPage: true });
    const jamieDoeLegacy = await page.getByText('Jamie Doe').isVisible().catch(() => false);
    if (jamieDoeLegacy) bugs.push({ page: 'Settings', description: 'Profile shows placeholder "Jamie Doe"', severity: 'high', observed: 'Found "Jamie Doe"' });
  } catch (e) { bugs.push({ page: 'Settings', description: 'Page failed to load', severity: 'critical', observed: e.message }); }

  try {
    await page.goto('http://localhost:3000/app/email-receipts', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/email-receipts-initial.png', fullPage: true });
  } catch (e) { bugs.push({ page: 'Email Receipts', description: 'Page failed to load', severity: 'critical', observed: e.message }); }

  try {
    await page.goto('http://localhost:3000/app/subscriptions', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/subscriptions-initial.png', fullPage: true });
  } catch (e) { bugs.push({ page: 'Subscriptions', description: 'Page failed to load', severity: 'critical', observed: e.message }); }

  if (bugs.length > 0) {
    const report = bugs.map((b, i) => `| ${i + 1} | ${b.page} | ${b.description} | ${b.severity} | ${b.observed} |`).join('\n') + '\n';
    fs.appendFileSync(BUG_REPORT, report);
    console.log(`\n✓ ${bugs.length} bugs written to BUG_REPORT.md`);
  } else {
    console.log('\n✓ No bugs found!');
  }
  await page.waitForTimeout(3000);
  await browser.close();
}

testCoconutApp().catch(console.error);
