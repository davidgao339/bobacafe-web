const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:8501');
  
  // Wait for login
  await page.waitForSelector('input[type="password"]');
  await page.fill('input[type="password"]', '2372');
  await page.click('button:has-text("Unlock")');
  
  // Wait for sidebar
  await page.waitForSelector('text=Boba Rabbit', { state: 'visible' });
  
  // Change month to August
  // It's a selectbox, Streamlit selectboxes are div[data-baseweb="select"]
  // But wait, the user said "August". Let's assume it's August 2026.
  
  // Click Databricks checkbox
  // Find checkbox by label text
  await page.click('text=Load schedule from Databricks snapshot');
  
  // Click Calculate
  await page.click('button:has-text("Calculate")');
  
  // Wait for it to finish (spinner goes away)
  // Or just wait for "Done:" text
  await page.waitForSelector('text=Done:', { timeout: 30000 });
  
  // Expand panel 7
  const expander7 = await page.$('text=7 · Detailed Verification by Store');
  if (expander7) await expander7.click();
  
  // Expand panel 8
  const expander8 = await page.$('text=8 · Store Breakdown');
  if (expander8) await expander8.click();
  
  // Wait a bit for expander to render
  await page.waitForTimeout(1000);
  
  // Dump text
  const text = await page.innerText('body');
  console.log("PAGE TEXT DUMP:");
  console.log(text.substring(0, 5000));
  
  await browser.close();
})();
