const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.setViewportSize({ width: 1280, height: 900 });

  console.log('Navigating to local dev server...');
  await page.goto('http://localhost:5173/demo/inventory-app/ozon');

  console.log('Uploading PDF...');
  await page.setInputFiles('input[type="file"]', 'C:\\Users\\david\\Downloads\\Вложения от 05.10.26 17-47.pdf');

  console.log('Waiting for parsing...');
  // Wait until the input list is populated
  await page.waitForSelector('input[title="Ozon Qty"]', { timeout: 15000 });

  // Type in the multiplier for the first item
  console.log('Setting multiplier for first item to 15200...');
  const multInputs = await page.$$('input[title="Base units per Ozon item"]');
  if (multInputs.length > 0) {
    // Select the content and type 15200
    await multInputs[0].fill('15200');
  }

  // Type in a mapping for the first item
  const mapInputs = await page.$$('input[list="ingredients-list"]');
  if (mapInputs.length > 0) {
    await mapInputs[0].fill('Milk');
  }

  // Wait a moment for calculation to update the UI
  await page.waitForTimeout(500);

  console.log('Taking screenshot...');
  const screenshotPath = path.join(__dirname, 'screenshot_ozon_multiplier.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to ${screenshotPath}`);

  await browser.close();
})();
