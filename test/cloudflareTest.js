const puppeteer = require('puppeteer-core');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// 启用 stealth 反检测
// puppeteer.use(StealthPlugin());

const {pageController} = require('./module/pageController');

const {mergeCookie} = require('../util/cookie');
const {safeClose} = require('../util/cloudflare');

/**
 * 获取 jm 的 cloudflare 的cookie
 * @param browser           CdpBrowser（Chrome DevTools Protocol）
 * @param page              CdpPage
 * @param url               指定站点
 * @param onProgress        进度
 * @return {Promise<{cookie: string, userAgent: string}>}
 */
async function getJmCloudflareCookie(browser, page,  url, onProgress,) {
    let width = 1920, height = 1080;
    let cookie = '';
    await page.goto(url, {
        waitUntil: 'domcontentloaded'
    });
    await page.setViewport({
        width: width,
        height: height
    });
    // 方法B：页面请求时拦截加上头
    // 3、注册响应查看，方便排查
    let userAgent, cookies, extraHeaders = {}, complete = 0;
    onProgress?.(complete, 100);
    page.on('response', async (resp) => {
        try {
            // 1、页面502则重载页面
            let title = await page.evaluate(async () => {
                return (document.title || '');
            });
            if (title.includes('502') && title.includes('Bad gateway')) {
                await page.reload();
                return;
            }
            // 2、累加请求到的cookie
            let req = resp.request();
            let method = req.method();
            let url = resp.url();
            let reqHeaders = req.headers() || {};
            let respHeaders = resp.headers() || {};
            let reqCookie = reqHeaders['cookie'];
            let respCookie = respHeaders['set-cookie'];
            if (!!reqCookie || !!respCookie) {
                cookie = mergeCookie(cookie, reqCookie);
                cookie = mergeCookie(cookie, respCookie);
            }
            for(let key in reqHeaders) {
                if (reqHeaders.hasOwnProperty(key)) {
                    if (key.startsWith('sec-')) {
                        extraHeaders[key] = reqHeaders[key];
                    }
                }
            }
            // 3、判断是否关闭页面
            const body = (await resp.text()) || '';
            if (body.includes('禁漫天堂') || body.includes('个人资料')) {
                // 8、获取 cookie、userAgent
                userAgent = await browser.userAgent();
                let cookies1 = await browser?.cookies?.();
                let cookies2 = await page?.cookies?.();
                cookies = [
                    ...(cookies1 || []),
                    ...(cookies2 || [])
                ];
                // 4、关闭页面
                await safeClose(page, {});
            }
        } catch (e) {
           // console.log(e);
        } finally {
            complete += 1;
            onProgress?.(complete, 100);
        }
    });
    await page.waitForFunction(
        () => false,
        { timeout: 0 }
    ).catch(() => {});
    cookie = mergeCookie(cookie, (cookies || []).map((c) => {
        return c.name + "=" + c.value;
    }).join(';'));
    onProgress?.(100, 100);
    console.log('\n')
    return {
        userAgent,
        cookie,
        extraHeaders
    };
}


(async () => {
    let width = 1920, height = 1080;
    let proxy = 'http://127.0.0.1:10809';
    let options = {
        executablePath:
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: 'new',
        args: [
            `--proxy-server=${proxy}`,
            `--window-size=${width},${height}`,
            '--lang=zh-CN',
            '--enable-features=UserAgentClientHint',
            // '--auto-open-devtools-for-tabs', // 打开开发者工具的控制台
            // 禁用“保存密码”气泡/弹窗
            "--disable-save-password-bubble",
            // 通过 feature 关闭密码管理器相关功能（较新 Chrome 更有效）
            "--disable-features=PasswordManager,PasswordLeakDetection",
            // 禁用“登录 Chrome / 同步”类的促销与询问
            "--disable-signin-promo",
            "--disable-sync",
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-blink-features=AutomationControlled',
            // '--disable-extensions',
            '--disable-infobars',
            '--disable-bookmark-bar',
            '--window-position=center',
            '--app=about:blank',        // ✅ 去掉地址栏（Chromium app mode）
        ],
    };
    const browser = await puppeteer.launch(options);
    const page = await browser.newPage();
    let pageControllerConfig = {
        browser,
        page,
        proxy,
        turnstile: true,
        pid: browser.process()?.pid,
        plugins: [

        ]
    };

    await pageController({
        ...pageControllerConfig,
        killProcess: true
    });
    browser.on("targetcreated", async (target) => {
        if (target.type() === "page") {
            let newPage = await target.page();
            pageControllerConfig.page = newPage;
            newPage = await pageController(pageControllerConfig);
        }
    });
    // 获取cookie
    let {
        cookie,
        userAgent
    } = await getJmCloudflareCookie(browser, page, "https://18comic.vip/login", (complete, total) => {
        console.log(`${complete} / ${total}`);
    });
    console.log(cookie);
})();