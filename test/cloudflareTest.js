const {mergeCookie} = require('../util/cookie');
const {safeClose, getJmCloudflareCookie, connectByPuppeteerRealBrowser} = require('../util/cloudflare');

(async () => {
    let {
        browser,
        page
    } = await connectByPuppeteerRealBrowser('http://127.0.0.1:10809');
    // 获取cookie
    let {
        cookie,
        userAgent
    } = await getJmCloudflareCookie(browser, page, "https://18comic.vip/login", (complete, total) => {
        console.log(`${complete} / ${total}`);
    });
    console.log(cookie);
})();
