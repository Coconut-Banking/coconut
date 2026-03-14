/**
 * Detailed bug hunt script. Run from project root: node e2e/scripts/test-detailed-bug-hunt.js
 * Requires: npm run dev so localhost:3000 is serving.
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
  let bugCounter = 1;

  fs.mkdirSync(path.join(process.cwd(), 'screenshots'), { recursive: true });

  console.log('\n=== TESTING SETTINGS PAGE ===\n');
  try {
    await page.goto('http://localhost:3000/app/settings', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/01-settings-page.png', fullPage: true });

    const pageText = await page.textContent('body') || '';
    if (pageText.includes('Jamie Doe') || pageText.includes('jamie.doe')) {
      bugs.push({ num: bugCounter++, page: 'Settings', description: 'Profile shows placeholder "Jamie Doe"', severity: 'high', observed: 'Found placeholder text' });
    }
  } catch (error) {
    bugs.push({ num: bugCounter++, page: 'Settings', description: 'Settings page crashed', severity: 'critical', observed: error.message });
  }

  console.log('\n=== TESTING EMAIL RECEIPTS PAGE ===\n');
  try {
    await page.goto('http://localhost:3000/app/email-receipts', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/03-email-receipts-page.png', fullPage: true });
  } catch (error) {
    bugs.push({ num: bugCounter++, page: 'Email Receipts', description: 'Page crashed', severity: 'critical', observed: error.message });
  }

  console.log('\n=== TESTING SUBSCRIPTIONS PAGE ===\n');
  try {
    await page.goto('http://localhost:3000/app/subscriptions', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/04-subscriptions-page.png', fullPage: true });
  } catch (error) {
    bugs.push({ num: bugCounter++, page: 'Subscriptions', description: 'Page crashed', severity: 'critical', observed: error.message });
  }

  if (bugs.length > 0) {
    let bugReport = bugs.map(b => `| ${b.num} | ${b.page} | ${b.description} | ${b.severity} | ${b.observed} |`).join('\n') + '\n';
    fs.appendFileSync(BUG_REPORT, bugReport);
    console.log(`\n✅ ${bugs.length} bugs written to BUG_REPORT.md`);
  } else {
    console.log('✅ No bugs found!');
  }

  await page.waitForTimeout(3000);
  await browser.close();
}

testCoconutApp().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
