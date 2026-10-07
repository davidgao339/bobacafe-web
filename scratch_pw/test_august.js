const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:8502');
  
  await page.waitForSelector('input[type="password"]');
  await page.fill('input[type="password"]', '2372');
  await page.click('button:has-text("Unlock")');
  
  await page.waitForSelector('text=Boba Rabbit', { state: 'visible' });
  
  // Select August
  // Streamlit dropdowns are a bit tricky to interact with
  await page.click('text=September'); // The current month is September
  await page.click('text=August');    // Click August in the dropdown
  
  await page.click('text=Load schedule from Databricks snapshot');
  await page.click('button:has-text("Calculate")');
  await page.waitForSelector('text=Done:', { timeout: 30000 });
  
  await page.waitForTimeout(2000);
  
  const text = await page.innerText('body');
  console.log("PAGE TEXT DUMP:");
  console.log(text.substring(0, 3000));
  
  await browser.close();
})();
