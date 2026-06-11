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
    let cookie = '';
    await page.goto(url, {
        waitUntil: 'domcontentloaded'
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
            console.log(`[${method}] ${url}`);
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

async function connectByPuppeteerRealBrowser(proxy) {
    const {connect} = require('puppeteer-real-browser');
    let width = 960, height = 540;
    let {
        browser,
        page
    } = await connect({
        headless: 'new',
        plugins: [
            require("puppeteer-extra-plugin-stealth")(),
            require("puppeteer-extra-plugin-human-typing")(),
            require("puppeteer-extra-plugin-anonymize-ua")()
        ],
        args: [
            `--proxy-server=${proxy}`,
            `--window-size=${width},${height}`,
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
            ' --disable-web-security',
            '--lang=zh-CN',                                    // 设置语言
            '--timezone=Asia/Shanghai',                        // 时区（部分版本
            '--force-device-scale-factor=1',                   // 强制 DPR
            '--disable-features=IsolateOrigins,TranslateUI',   // 关隔离/翻译
            // '--start-maximized',                                // 启动时最大化
            // '--kiosk',                                          // 全屏展台模式
            "--no-sandbox",                                     // 禁用沙盒
            "--disable-setuid-sandbox",                         // 禁用 setuid 沙盒
            '--disable-blink-features=AutomationControlled',    // 阻止设置 navigator.webdriver=true
            '--disable-infobars',                               // 移除“Chrome 正被自动软件控制”条
            '--no-first-run',                                   // 跳过首次运行向导
            '--enable-features=UserAgentClientHint',
            // '--auto-open-devtools-for-tabs', // 打开开发者工具的控制台
            // 禁用“保存密码”气泡/弹窗
            "--disable-save-password-bubble",
            // 通过 feature 关闭密码管理器相关功能（较新 Chrome 更有效）
            "--disable-features=PasswordManager,PasswordLeakDetection",
            // 禁用“登录 Chrome / 同步”类的促销与询问
            "--disable-signin-promo",
            "--disable-sync",
            '--disable-software-rasterizer',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-background-networking',
            // '--disable-extensions',
            '--disable-bookmark-bar',
            '--window-position=center',
            '--app=https://18comic.vip/login',        // ✅ 去掉地址栏（Chromium app mode）,
        ],
    });
    await page.setViewport({
        width: width,
        height: height
    });
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: function () {
                return undefined;
            }
        });
    });
    return {
        browser,
        page
    };
}

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
