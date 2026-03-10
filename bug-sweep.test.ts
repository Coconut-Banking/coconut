import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

interface Bug {
  number: number;
  page: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  observation: string;
}

const bugs: Bug[] = [];
let bugCounter = 1;

function addBug(page: string, description: string, severity: Bug['severity'], observation: string) {
  bugs.push({
    number: bugCounter++,
    page,
    description,
    severity,
    observation
  });
}

async function checkConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    errors.push(err.message);
  });
  return errors;
}

async function checkPageLoad(page: Page, url: string, pageName: string, screenshotName: string) {
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
    
    if (!response || response.status() >= 400) {
      addBug(pageName, `Page failed to load with status ${response?.status()}`, 'critical', `Navigation to ${url} returned HTTP ${response?.status()}`);
    }

    await page.screenshot({ path: `playwright-report/${screenshotName}.png`, fullPage: true });
    
    // Check for visible errors on page
    const errorTexts = await page.locator('text=/error|Error|ERROR/i').allTextContents();
    if (errorTexts.length > 0) {
      addBug(pageName, 'Error text visible on page', 'high', `Found error messages: ${errorTexts.join(', ')}`);
    }

    // Check for broken images
    const images = await page.locator('img').all();
    for (const img of images) {
      const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
      if (naturalWidth === 0) {
        const src = await img.getAttribute('src');
        addBug(pageName, 'Broken image detected', 'medium', `Image with src="${src}" failed to load`);
      }
    }

  } catch (error) {
    addBug(pageName, `Page failed to load`, 'critical', `Error: ${error}`);
    await page.screenshot({ path: `playwright-report/${screenshotName}-error.png`, fullPage: true });
  }
}

test.describe('Coconut App Bug Sweep', () => {
  test.beforeEach(async ({ page }) => {
    // Setup console error tracking
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('Console Error:', msg.text());
      }
    });
    page.on('pageerror', err => {
      console.log('Page Error:', err.message);
    });
  });

  test('1. Test /app/shared page', async ({ page }) => {
    await checkPageLoad(page, 'http://localhost:3000/app/shared', 'Shared Expenses', '01-shared');
    
    // Wait for content to load
    await page.waitForTimeout(2000);

    // Check if empty state or content is shown
    const pageContent = await page.textContent('body');
    if (!pageContent || pageContent.trim().length < 100) {
      addBug('Shared Expenses', 'Page appears empty or minimal content', 'high', 'Page body has very little text content');
    }

    // Check for shared expenses list or empty state
    const hasSharedList = await page.locator('[data-testid="shared-list"]').count() > 0;
    const hasEmptyState = await page.locator('text=/no shared expenses|empty/i').count() > 0;
    
    if (!hasSharedList && !hasEmptyState) {
      addBug('Shared Expenses', 'No shared expenses list or empty state visible', 'medium', 'Expected to see either shared expenses or an empty state message');
    }

    // Test buttons
    const buttons = await page.locator('button').all();
    for (let i = 0; i < Math.min(buttons.length, 5); i++) {
      const button = buttons[i];
      const isVisible = await button.isVisible();
      const isEnabled = await button.isEnabled();
      const text = await button.textContent();
      
      if (!isVisible) {
        addBug('Shared Expenses', `Button not visible: "${text}"`, 'low', `Button "${text}" exists but is not visible`);
      }
    }
  });

  test('2. Test /app/receipt page', async ({ page }) => {
    await checkPageLoad(page, 'http://localhost:3000/app/receipt', 'Split Receipt', '02-receipt');
    
    await page.waitForTimeout(2000);

    // Check for upload functionality
    const uploadButton = await page.locator('input[type="file"]').count();
    if (uploadButton === 0) {
      addBug('Split Receipt', 'No file upload input found', 'high', 'Expected a file input for receipt upload but none found');
    }

    // Check for split UI elements
    const hasSplitUI = await page.locator('text=/split|divide|share/i').count() > 0;
    if (!hasSplitUI) {
      addBug('Split Receipt', 'No split-related UI text found', 'medium', 'Expected to see split/divide/share related text');
    }

    // Check for any visual glitches (overlapping elements)
    const overlaps = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      // Simple overlap check - this is a basic heuristic
      return elements.filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > window.innerWidth * 1.5; // Element wider than viewport
      }).length;
    });
    
    if (overlaps > 0) {
      addBug('Split Receipt', 'Potential layout overflow detected', 'low', `${overlaps} elements appear wider than viewport`);
    }
  });

  test('3. Test /connect page', async ({ page }) => {
    await checkPageLoad(page, 'http://localhost:3000/connect', 'Connect Bank', '03-connect');
    
    await page.waitForTimeout(2000);

    // Check for Plaid button
    const plaidButton = await page.locator('button:has-text("Connect"), button:has-text("Plaid"), button:has-text("Link")').count();
    if (plaidButton === 0) {
      addBug('Connect Bank', 'No Plaid/Connect button found', 'high', 'Expected a button to connect bank account');
    } else {
      // Try clicking the button
      try {
        const button = page.locator('button:has-text("Connect"), button:has-text("Plaid"), button:has-text("Link")').first();
        const isEnabled = await button.isEnabled();
        if (!isEnabled) {
          addBug('Connect Bank', 'Connect button is disabled', 'medium', 'The primary connect button is not clickable');
        }
      } catch (error) {
        addBug('Connect Bank', 'Error interacting with connect button', 'medium', `${error}`);
      }
    }

    // Check for back button
    const backButton = await page.locator('button:has-text("Back"), a:has-text("Back")').count();
    if (backButton === 0) {
      addBug('Connect Bank', 'No back button found', 'low', 'Expected a back button for navigation');
    }
  });

  test('4. Test /login page', async ({ page }) => {
    await checkPageLoad(page, 'http://localhost:3000/login', 'Login', '04-login');
    
    await page.waitForTimeout(2000);

    // Check for Clerk widget or sign-in form
    const hasClerkWidget = await page.locator('[data-clerk-id], .cl-component').count() > 0;
    const hasEmailInput = await page.locator('input[type="email"]').count() > 0;
    const hasPasswordInput = await page.locator('input[type="password"]').count() > 0;
    const hasSignInText = await page.locator('text=/sign in/i').count() > 0;
    const hasSignInForm = hasEmailInput || hasPasswordInput || hasSignInText;
    
    if (!hasClerkWidget && !hasSignInForm) {
      addBug('Login', 'No Clerk widget or sign-in form visible', 'critical', 'Expected Clerk authentication widget but found none');
    }

    // Check page title or heading
    const hasLoginHeading = await page.locator('h1, h2').filter({ hasText: /login|sign in/i }).count() > 0;
    if (!hasLoginHeading) {
      addBug('Login', 'No login heading found', 'low', 'Expected a heading indicating this is the login page');
    }
  });

  test('5. Test sidebar navigation', async ({ page }) => {
    await page.goto('http://localhost:3000/app/shared', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'playwright-report/05-sidebar.png', fullPage: true });

    // Check for sidebar
    const sidebar = await page.locator('nav, aside, [role="navigation"]').first();
    const sidebarExists = await sidebar.count() > 0;
    
    if (!sidebarExists) {
      addBug('Navigation', 'No sidebar navigation found', 'high', 'Expected a sidebar/nav element but none found');
      return;
    }

    // Check for navigation links
    const navLinks = await page.locator('nav a, aside a, [role="navigation"] a').all();
    if (navLinks.length === 0) {
      addBug('Navigation', 'No navigation links in sidebar', 'high', 'Sidebar exists but has no links');
    }

    // Try clicking a few nav links
    for (let i = 0; i < Math.min(navLinks.length, 3); i++) {
      try {
        const link = navLinks[i];
        const href = await link.getAttribute('href');
        const text = await link.textContent();
        
        if (!href) {
          addBug('Navigation', `Navigation link missing href: "${text}"`, 'medium', `Link "${text}" has no href attribute`);
        }
      } catch (error) {
        addBug('Navigation', 'Error checking navigation link', 'low', `${error}`);
      }
    }

    // Check for user profile
    const hasUserProfile = await page.locator('[data-testid="user-profile"], .user-profile, text=/profile|account/i').count() > 0;
    if (!hasUserProfile) {
      addBug('Navigation', 'No user profile element in sidebar', 'medium', 'Expected user profile/account section in bottom-left');
    }
  });

  test.afterAll(async () => {
    // Write bugs to file
    const bugReportPath = '/Users/koushik/github/coconut/BUG_REPORT.md';
    let content = fs.readFileSync(bugReportPath, 'utf-8');
    
    // Append bugs to table
    for (const bug of bugs) {
      const row = `| ${bug.number} | ${bug.page} | ${bug.description} | ${bug.severity} | ${bug.observation} |\n`;
      content += row;
    }
    
    fs.writeFileSync(bugReportPath, content);
    
    console.log(`\n=== BUG SWEEP COMPLETE ===`);
    console.log(`Total bugs found: ${bugs.length}`);
    console.log(`Bugs by severity:`);
    console.log(`  Critical: ${bugs.filter(b => b.severity === 'critical').length}`);
    console.log(`  High: ${bugs.filter(b => b.severity === 'high').length}`);
    console.log(`  Medium: ${bugs.filter(b => b.severity === 'medium').length}`);
    console.log(`  Low: ${bugs.filter(b => b.severity === 'low').length}`);
  });
});
