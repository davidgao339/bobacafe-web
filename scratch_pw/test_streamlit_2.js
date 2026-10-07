const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:8501');
  
  await page.waitForSelector('input[type="password"]');
  await page.fill('input[type="password"]', '2372');
  await page.click('button:has-text("Unlock")');
  
  await page.waitForSelector('text=Boba Rabbit', { state: 'visible' });
  await page.click('text=Load schedule from Databricks snapshot');
  await page.click('button:has-text("Calculate")');
  await page.waitForSelector('text=Done:', { timeout: 30000 });
  
  // Wait a bit to ensure it renders completely
  await page.waitForTimeout(2000);
  
  // Find all elements with text "No options to select"
  const noOptions = await page.$$('text=No options to select');
  console.log(`Found ${noOptions.length} "No options to select" elements`);
  
  // Check if there's any traceback or error on the page
  const text = await page.innerText('body');
  if (text.includes('Error:') || text.includes('Traceback')) {
    console.log("ERROR FOUND ON PAGE:");
    console.log(text.substring(text.indexOf('Error:'), text.indexOf('Error:') + 1000));
  } else {
    console.log("No visible python error on page.");
  }
  
  await browser.close();
})();
