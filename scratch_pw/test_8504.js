const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:8504');
  
  await page.waitForSelector('input[type="password"]');
  await page.fill('input[type="password"]', '2372');
  await page.click('button:has-text("Unlock")');
  
  await page.waitForSelector('text=Boba Rabbit', { state: 'visible' });
  await page.click('text=Load schedule from Databricks snapshot');
  await page.click('button:has-text("Calculate")');
  
  await page.waitForTimeout(10000); // Wait for the error rendering
  
  const text = await page.innerText('body');
  console.log("PAGE TEXT DUMP:");
  console.log(text.substring(0, 3000));
  
  await browser.close();
})();
