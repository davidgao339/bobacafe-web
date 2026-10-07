const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
    } else {
      console.log('LOG:', msg.text());
    }
  });

  page.on('pageerror', error => {
    console.log('PAGE EXCEPTION:', error.message);
  });

  try {
    await page.goto('http://localhost:5173/demo/inventory-app/ozon', { waitUntil: 'networkidle' });
    
    // Login if needed
    const pinInput = page.locator('input[type="password"]');
    if (await pinInput.count() > 0) {
      await pinInput.fill('7530');
      await pinInput.press('Enter');
      await page.waitForTimeout(2000);
    }

    // Now upload the file
    console.log('Uploading file...');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles('C:\\Users\\david\\Downloads\\Вложения от 05.10.26 17-47.pdf');
    
    // Wait for parsing
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'd:\\Github\\bobacafe-web\\scratch_pw\\ozon_success.png' });

  } catch (e) {
    console.error('Script error:', e);
  } finally {
    await browser.close();
  }
})();
