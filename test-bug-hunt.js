const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function testCoconutApp() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  
  const bugs = [];
  let bugNumber = 1;
  
  console.log('\n=== Testing Settings Page ===\n');
  
  // Test 1: Settings Page
  try {
    await page.goto('http://localhost:3000/app/settings', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    // Take screenshot
    await page.screenshot({ path: 'screenshots/settings-initial.png', fullPage: true });
    console.log('✓ Settings page loaded');
    
    // Check profile section
    const profileName = await page.locator('text=/name/i').first().isVisible().catch(() => false);
    const profileEmail = await page.locator('text=/email/i').first().isVisible().catch(() => false);
    
    // Check for "Jamie Doe" placeholder
    const jamieDoeLegacy = await page.getByText('Jamie Doe').isVisible().catch(() => false);
    if (jamieDoeLegacy) {
      bugs.push({
        page: 'Settings',
        description: 'Profile section shows placeholder "Jamie Doe" instead of actual user',
        severity: 'high',
        observed: 'Found "Jamie Doe" text on settings page'
      });
      console.log('✗ Bug found: Jamie Doe placeholder');
    }
    
    // Check bank connection status
    const bankSection = await page.locator('text=/bank/i').first().isVisible().catch(() => false);
    console.log(`Bank section visible: ${bankSection}`);
    
    // Check Gmail section
    const gmailSection = await page.locator('text=/gmail/i').first().isVisible().catch(() => false);
    console.log(`Gmail section visible: ${gmailSection}`);
    
    // Test buttons
    const saveButton = await page.getByRole('button', { name: /save/i }).isVisible().catch(() => false);
    if (saveButton) {
      console.log('✓ Save button found');
    }
    
    // Check for disconnect button
    const disconnectButton = await page.getByRole('button', { name: /disconnect/i }).first().isVisible().catch(() => false);
    if (disconnectButton) {
      console.log('✓ Disconnect button found');
    }
    
    // Check Add account link
    const addAccountLink = await page.getByRole('link', { name: /add account/i }).isVisible().catch(() => false);
    console.log(`Add account link visible: ${addAccountLink}`);
    
  } catch (error) {
    bugs.push({
      page: 'Settings',
      description: 'Settings page failed to load or crashed',
      severity: 'critical',
      observed: error.message
    });
    console.log('✗ Settings page error:', error.message);
  }
  
  console.log('\n=== Testing Email Receipts Page ===\n');
  
  // Test 2: Email Receipts Page
  try {
    await page.goto('http://localhost:3000/app/email-receipts', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: 'screenshots/email-receipts-initial.png', fullPage: true });
    console.log('✓ Email receipts page loaded');
    
    // Check for error messages
    const errorVisible = await page.locator('text=/error/i').first().isVisible().catch(() => false);
    if (errorVisible) {
      const errorText = await page.locator('text=/error/i').first().textContent();
      bugs.push({
        page: 'Email Receipts',
        description: 'Error message displayed on email receipts page',
        severity: 'high',
        observed: errorText
      });
      console.log('✗ Error found:', errorText);
    }
    
    // Check for Gmail connection prompt
    const connectGmail = await page.locator('text=/connect.*gmail/i').first().isVisible().catch(() => false);
    console.log(`Gmail connection prompt visible: ${connectGmail}`);
    
    // Check for search/filter
    const searchInput = await page.getByPlaceholder(/search/i).isVisible().catch(() => false);
    console.log(`Search input visible: ${searchInput}`);
    
    // Check for scan button
    const scanButton = await page.getByRole('button', { name: /scan/i }).isVisible().catch(() => false);
    console.log(`Scan button visible: ${scanButton}`);
    
    // Check if receipts are displayed
    const receiptsCount = await page.locator('[class*="receipt"]').count().catch(() => 0);
    console.log(`Receipts found: ${receiptsCount}`);
    
  } catch (error) {
    bugs.push({
      page: 'Email Receipts',
      description: 'Email receipts page failed to load',
      severity: 'critical',
      observed: error.message
    });
    console.log('✗ Email receipts error:', error.message);
  }
  
  console.log('\n=== Testing Subscriptions Page ===\n');
  
  // Test 3: Subscriptions Page
  try {
    await page.goto('http://localhost:3000/app/subscriptions', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: 'screenshots/subscriptions-initial.png', fullPage: true });
    console.log('✓ Subscriptions page loaded');
    
    // Check for detect subscriptions button
    const detectButton = await page.getByRole('button', { name: /detect.*subscription/i }).isVisible().catch(() => false);
    console.log(`Detect subscriptions button visible: ${detectButton}`);
    
    // Check if subscriptions are displayed
    const subsCount = await page.locator('[class*="subscription"]').count().catch(() => 0);
    console.log(`Subscriptions found: ${subsCount}`);
    
  } catch (error) {
    bugs.push({
      page: 'Subscriptions',
      description: 'Subscriptions page failed to load',
      severity: 'critical',
      observed: error.message
    });
    console.log('✗ Subscriptions error:', error.message);
  }
  
  // Save bugs to file
  if (bugs.length > 0) {
    console.log('\n=== Bugs Found ===\n');
    let bugReport = '';
    bugs.forEach((bug, index) => {
      bugReport += `| ${index + 1} | ${bug.page} | ${bug.description} | ${bug.severity} | ${bug.observed} |\n`;
      console.log(`${index + 1}. [${bug.severity}] ${bug.page}: ${bug.description}`);
    });
    
    fs.appendFileSync('/Users/koushik/github/coconut/BUG_REPORT.md', bugReport);
    console.log(`\n✓ Bugs written to BUG_REPORT.md`);
  } else {
    console.log('\n✓ No bugs found!');
  }
  
  console.log('\nPress any key to close browser...');
  await page.waitForTimeout(5000);
  
  await browser.close();
}

testCoconutApp().catch(console.error);
