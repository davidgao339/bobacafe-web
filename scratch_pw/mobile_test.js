const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  // Simulate iPhone 12/13/14 viewport
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  
  try {
    console.log('Navigating to quick count...');
    await page.goto('http://localhost:5173/demo/inventory-app/quick-count');
    
    // Evaluate javascript in browser to set session/local storage if needed, but quick-count handles auth or requires PIN
    // Wait for the login screen or confirmation screen
    await page.waitForTimeout(2000);
    
    // Check if we are on the PIN screen. "PIN" placeholder
    const pinInput = await page.$('input[placeholder="PIN"]');
    if (pinInput) {
      console.log('Entering PIN...');
      await pinInput.fill('1234');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
    }

    // Now we might be on the "Шаг 1: Подтвердите филиал" screen
    const confirmBtn = await page.$('button:has-text("Начать инвентаризацию")');
    if (confirmBtn) {
      console.log('Confirming store...');
      await confirmBtn.click();
      await page.waitForTimeout(2000);
    }
    
    console.log('Taking screenshot...');
    // Scroll down slightly to show the guide and first items
    await page.evaluate(() => window.scrollBy(0, 100));
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'scratch_pw/mobile_quick_count.png', fullPage: false });
    console.log('Screenshot saved to scratch_pw/mobile_quick_count.png');
    
  } catch(e) {
    console.error('ERROR:', e);
  } finally {
    await browser.close();
  }
})();
