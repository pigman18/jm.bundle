'use strict';

/**
 * 带超时的安全退出，可结合 waitForFunction 永不退出使用
 * @param page
 * @param result
 * @return {Promise<void>}
 */
async function safeClose(page, result) {
  if (page.isClosed?.()) return;

  // console.log('🧹 safeClose start', result);

  await page.evaluate(() => window.stop?.()).catch(() => {});
  page.removeAllListeners('dialog');

  const closeTask = page.close();
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('page.close timeout')), 5000)
  );

  try {
    await Promise.race([closeTask, timeout]);
    // console.log('✅ page closed gracefully');
  } catch {
    // console.warn('⚠️ force kill browser');
    try {
      const browser = page.browser();
      await browser.close();
    } catch (_) {}
  }
}

module.exports = {
  safeClose
}
