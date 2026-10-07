const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.setViewportSize({ width: 1280, height: 900 });

  console.log('Navigating to local dev server...');
  await page.goto('http://localhost:5173/demo/inventory-app/ozon');
  await page.waitForTimeout(5000); // wait for 5 seconds

  console.log('Taking screenshot...');
  const screenshotPath = path.join(__dirname, 'screenshot_debug.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to ${screenshotPath}`);

  await browser.close();
})();
