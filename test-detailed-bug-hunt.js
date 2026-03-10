const { chromium } = require('playwright');
const fs = require('fs');

async function testCoconutApp() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  
  const bugs = [];
  let bugCounter = 1;
  
  console.log('\n=== TESTING SETTINGS PAGE ===\n');
  
  // TEST 1: Settings Page
  try {
    await page.goto('http://localhost:3000/app/settings', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(3000);
    
    // Take initial screenshot
    await page.screenshot({ path: 'screenshots/01-settings-page.png', fullPage: true });
    console.log('✓ Settings page loaded and screenshot captured');
    
    // Get all text content on the page
    const pageText = await page.textContent('body');
    console.log('\n--- Page Content Analysis ---');
    
    // Check for placeholder "Jamie Doe"
    if (pageText.includes('Jamie Doe') || pageText.includes('jamie.doe')) {
      bugs.push({
        num: bugCounter++,
        page: 'Settings',
        description: 'Profile shows placeholder "Jamie Doe" instead of actual logged-in user',
        severity: 'high',
        observed: 'Found "Jamie Doe" placeholder text in profile section'
      });
      console.log('✗ BUG: Found "Jamie Doe" placeholder');
    } else {
      console.log('✓ No "Jamie Doe" placeholder found');
    }
    
    // Check profile section structure
    const profileSection = await page.locator('h2:has-text("Profile"), h3:has-text("Profile")').first();
    if (await profileSection.isVisible().catch(() => false)) {
      console.log('✓ Profile section found');
      
      // Get the profile card content
      const profileCard = await profileSection.locator('..').locator('..').textContent().catch(() => '');
      console.log('Profile content:', profileCard.substring(0, 200));
      
      // Check for input fields
      const nameInput = await page.locator('input[name="name"], input[placeholder*="name" i]').count();
      const emailInput = await page.locator('input[name="email"], input[type="email"]').count();
      console.log(`Name inputs found: ${nameInput}, Email inputs found: ${emailInput}`);
      
      if (nameInput === 0 && emailInput === 0) {
        bugs.push({
          num: bugCounter++,
          page: 'Settings',
          description: 'Profile section missing name and email input fields',
          severity: 'high',
          observed: 'No input fields found for name or email in profile section'
        });
        console.log('✗ BUG: Missing profile input fields');
      }
    } else {
      bugs.push({
        num: bugCounter++,
        page: 'Settings',
        description: 'Profile section not visible or missing',
        severity: 'critical',
        observed: 'Could not find Profile heading/section on settings page'
      });
      console.log('✗ BUG: Profile section not found');
    }
    
    // Check bank connection section
    const bankHeading = await page.locator('h2:has-text("Bank"), h3:has-text("Bank"), text="Bank Connections", text="Connected Banks"').first();
    if (await bankHeading.isVisible().catch(() => false)) {
      console.log('✓ Bank section found');
      
      // Check for bank status indicators
      const connectedText = await page.getByText(/connected/i).count();
      const disconnectedText = await page.getByText(/disconnected/i).count();
      console.log(`Status indicators - Connected: ${connectedText}, Disconnected: ${disconnectedText}`);
      
      // Check for Plaid or bank-related buttons
      const addBankButton = await page.getByRole('button', { name: /add.*bank|connect.*bank/i }).count();
      const disconnectButton = await page.getByRole('button', { name: /disconnect|remove/i }).count();
      console.log(`Bank buttons - Add: ${addBankButton}, Disconnect: ${disconnectButton}`);
    } else {
      console.log('⚠ Bank section not clearly visible');
    }
    
    // Check Gmail section
    const gmailHeading = await page.locator('h2:has-text("Gmail"), h3:has-text("Gmail"), h2:has-text("Email"), h3:has-text("Email")').first();
    if (await gmailHeading.isVisible().catch(() => false)) {
      console.log('✓ Gmail/Email section found');
      
      // Check for Gmail connection status
      const gmailCard = await gmailHeading.locator('..').locator('..').textContent().catch(() => '');
      console.log('Gmail section content:', gmailCard.substring(0, 200));
      
      const connectButton = await page.getByRole('button', { name: /connect.*gmail/i }).count();
      const disconnectGmailButton = await page.getByRole('button', { name: /disconnect.*gmail/i }).count();
      console.log(`Gmail buttons - Connect: ${connectButton}, Disconnect: ${disconnectGmailButton}`);
    } else {
      console.log('⚠ Gmail section not clearly visible');
    }
    
    // Check for Save Changes button
    const saveButton = await page.getByRole('button', { name: /save.*change/i }).first();
    if (await saveButton.isVisible().catch(() => false)) {
      console.log('✓ Save Changes button found');
      
      // Try to click it and see if it works
      const saveScreenshot = await page.screenshot({ path: 'screenshots/02-settings-before-save.png', fullPage: true });
      await saveButton.click();
      await page.waitForTimeout(1000);
      
      // Check for success message or error
      const successMsg = await page.getByText(/success|saved/i).isVisible({ timeout: 2000 }).catch(() => false);
      const errorMsg = await page.getByText(/error|fail/i).isVisible({ timeout: 2000 }).catch(() => false);
      
      if (errorMsg) {
        const errorText = await page.locator('text=/error|fail/i').first().textContent();
        bugs.push({
          num: bugCounter++,
          page: 'Settings',
          description: 'Save Changes button triggers an error',
          severity: 'high',
          observed: `Error message: ${errorText}`
        });
        console.log('✗ BUG: Save Changes shows error:', errorText);
      } else if (!successMsg) {
        console.log('⚠ No clear feedback after clicking Save Changes');
      } else {
        console.log('✓ Save Changes appears to work');
      }
    } else {
      console.log('⚠ Save Changes button not found');
    }
    
    // Check for visual glitches
    const buttons = await page.getByRole('button').all();
    console.log(`Total buttons on page: ${buttons.length}`);
    
    for (const button of buttons) {
      const isVisible = await button.isVisible().catch(() => false);
      if (isVisible) {
        const box = await button.boundingBox().catch(() => null);
        if (box && (box.width < 10 || box.height < 10)) {
          const text = await button.textContent();
          bugs.push({
            num: bugCounter++,
            page: 'Settings',
            description: 'Button too small or collapsed',
            severity: 'medium',
            observed: `Button "${text}" has dimensions ${box.width}x${box.height}px`
          });
          console.log(`✗ BUG: Tiny button found: "${text}"`);
        }
      }
    }
    
  } catch (error) {
    bugs.push({
      num: bugCounter++,
      page: 'Settings',
      description: 'Settings page crashed or failed to load',
      severity: 'critical',
      observed: error.message
    });
    console.log('✗ CRITICAL ERROR on Settings page:', error.message);
  }
  
  console.log('\n=== TESTING EMAIL RECEIPTS PAGE ===\n');
  
  // TEST 2: Email Receipts Page
  try {
    await page.goto('http://localhost:3000/app/email-receipts', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: 'screenshots/03-email-receipts-page.png', fullPage: true });
    console.log('✓ Email receipts page loaded and screenshot captured');
    
    const pageText = await page.textContent('body');
    
    // Check if page shows an error state
    if (pageText.includes('Error') || pageText.includes('error') || pageText.includes('failed')) {
      const errorElement = await page.locator('text=/error|failed/i').first().textContent().catch(() => 'Unknown error');
      bugs.push({
        num: bugCounter++,
        page: 'Email Receipts',
        description: 'Page shows error message',
        severity: 'high',
        observed: errorElement
      });
      console.log('✗ BUG: Error message displayed:', errorElement);
    }
    
    // Check for Gmail connection prompt
    const connectGmailMsg = await page.getByText(/connect.*gmail|gmail.*not.*connected/i).isVisible().catch(() => false);
    if (connectGmailMsg) {
      console.log('ℹ Gmail not connected - showing connection prompt (expected behavior if not connected)');
    }
    
    // Check for search functionality
    const searchInput = await page.getByPlaceholder(/search/i).first();
    if (await searchInput.isVisible().catch(() => false)) {
      console.log('✓ Search input found');
      
      // Try typing in search
      await searchInput.fill('test receipt');
      await page.waitForTimeout(500);
      console.log('✓ Search input accepts text');
    } else {
      console.log('⚠ Search input not found');
    }
    
    // Check for Scan button
    const scanButton = await page.getByRole('button', { name: /scan/i }).first();
    if (await scanButton.isVisible().catch(() => false)) {
      console.log('✓ Scan button found');
      
      // Try clicking scan button
      await scanButton.click();
      await page.waitForTimeout(1500);
      
      // Check if scan started or showed error
      const scanError = await page.getByText(/error.*scan|scan.*fail/i).isVisible({ timeout: 1000 }).catch(() => false);
      if (scanError) {
        bugs.push({
          num: bugCounter++,
          page: 'Email Receipts',
          description: 'Scan button triggers an error',
          severity: 'high',
          observed: 'Clicking scan button shows error message'
        });
        console.log('✗ BUG: Scan button shows error');
      } else {
        console.log('✓ Scan button clickable (may need Gmail connection)');
      }
    } else {
      console.log('⚠ Scan button not found');
    }
    
    // Check for receipt display
    const receiptCards = await page.locator('[class*="card"], [class*="receipt"], .receipt-item').count();
    console.log(`Receipt-like elements found: ${receiptCards}`);
    
    // Check if there's empty state vs actual receipts
    const emptyState = await page.getByText(/no.*receipt|no.*email|empty/i).isVisible().catch(() => false);
    if (emptyState) {
      console.log('ℹ Empty state shown (expected if no receipts)');
    }
    
    // Check for layout issues
    const mainContent = await page.locator('main, [role="main"], .main-content').first();
    if (await mainContent.isVisible().catch(() => false)) {
      const box = await mainContent.boundingBox();
      if (box && box.width < 300) {
        bugs.push({
          num: bugCounter++,
          page: 'Email Receipts',
          description: 'Main content area too narrow',
          severity: 'medium',
          observed: `Main content width only ${box.width}px`
        });
        console.log('✗ BUG: Content area too narrow');
      }
    }
    
  } catch (error) {
    bugs.push({
      num: bugCounter++,
      page: 'Email Receipts',
      description: 'Email receipts page crashed or failed to load',
      severity: 'critical',
      observed: error.message
    });
    console.log('✗ CRITICAL ERROR on Email Receipts page:', error.message);
  }
  
  console.log('\n=== TESTING SUBSCRIPTIONS PAGE ===\n');
  
  // TEST 3: Subscriptions Page
  try {
    await page.goto('http://localhost:3000/app/subscriptions', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: 'screenshots/04-subscriptions-page.png', fullPage: true });
    console.log('✓ Subscriptions page loaded and screenshot captured');
    
    const pageText = await page.textContent('body');
    
    // Check if page loaded properly
    const heading = await page.locator('h1, h2').first().textContent().catch(() => '');
    console.log('Page heading:', heading);
    
    // Check for Detect Subscriptions button
    const detectButton = await page.getByRole('button', { name: /detect.*subscription/i }).first();
    if (await detectButton.isVisible().catch(() => false)) {
      console.log('✓ Detect Subscriptions button found');
      
      // Try clicking it
      await detectButton.click();
      await page.waitForTimeout(2000);
      
      // Check for loading state or results
      const loading = await page.getByText(/detecting|analyzing|loading/i).isVisible({ timeout: 1000 }).catch(() => false);
      const error = await page.getByText(/error.*detect|fail/i).isVisible({ timeout: 1000 }).catch(() => false);
      
      if (error) {
        bugs.push({
          num: bugCounter++,
          page: 'Subscriptions',
          description: 'Detect Subscriptions button triggers an error',
          severity: 'high',
          observed: 'Error shown after clicking detect button'
        });
        console.log('✗ BUG: Detect button shows error');
      } else if (loading) {
        console.log('✓ Detect button shows loading state');
      } else {
        console.log('✓ Detect button clickable');
      }
      
      await page.screenshot({ path: 'screenshots/05-subscriptions-after-detect.png', fullPage: true });
    } else {
      console.log('⚠ Detect Subscriptions button not found');
    }
    
    // Check for subscription display
    const subscriptionCards = await page.locator('[class*="subscription"], [class*="card"]').count();
    console.log(`Subscription-like elements found: ${subscriptionCards}`);
    
    // Check for empty state
    const emptyState = await page.getByText(/no.*subscription|no.*recurring|empty/i).isVisible().catch(() => false);
    if (emptyState) {
      console.log('ℹ Empty state shown (expected if no subscriptions detected)');
    }
    
    // Check for visual issues
    const allText = await page.locator('body').textContent();
    if (allText.includes('undefined') || allText.includes('null') || allText.includes('[object Object]')) {
      bugs.push({
        num: bugCounter++,
        page: 'Subscriptions',
        description: 'Page shows undefined/null values in UI',
        severity: 'high',
        observed: 'Found "undefined" or "null" text displayed on page'
      });
      console.log('✗ BUG: Undefined/null values visible in UI');
    }
    
  } catch (error) {
    bugs.push({
      num: bugCounter++,
      page: 'Subscriptions',
      description: 'Subscriptions page crashed or failed to load',
      severity: 'critical',
      observed: error.message
    });
    console.log('✗ CRITICAL ERROR on Subscriptions page:', error.message);
  }
  
  // Write bugs to BUG_REPORT.md
  console.log('\n=== BUG REPORT SUMMARY ===\n');
  
  if (bugs.length > 0) {
    console.log(`Found ${bugs.length} bug(s):\n`);
    
    let bugReport = '';
    bugs.forEach(bug => {
      bugReport += `| ${bug.num} | ${bug.page} | ${bug.description} | ${bug.severity} | ${bug.observed} |\n`;
      console.log(`${bug.num}. [${bug.severity.toUpperCase()}] ${bug.page}: ${bug.description}`);
      console.log(`   Observed: ${bug.observed}\n`);
    });
    
    fs.appendFileSync('/Users/koushik/github/coconut/BUG_REPORT.md', bugReport);
    console.log(`\n✅ ${bugs.length} bugs written to BUG_REPORT.md`);
  } else {
    console.log('✅ No bugs found! All pages appear to be working correctly.');
  }
  
  console.log('\nKeeping browser open for 5 seconds for review...');
  await page.waitForTimeout(5000);
  
  await browser.close();
  console.log('\n✅ Testing complete!');
}

testCoconutApp().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
