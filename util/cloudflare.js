'use strict';
const {mergeCookie} = require('./cookie');
const {execSync} = require('node:child_process');

/**
 * 带超时的安全退出，可结合 waitForFunction 永不退出使用
 * @param page
 * @param result
 * @return {Promise<void>}
 */
async function safeClose(page) {
    if (page.isClosed()) return;

    await page.evaluate(() => window.stop()).catch(() => {
    });
    page.removeAllListeners('dialog');

    try {
        await Promise.race([
            page.close(),
            new Promise((_, reject) => setTimeout(() => reject(), 5000))
        ]);
    } catch {
        try {
            await page.context()?.close();
        } catch (_) {
        }
    }
}

function hideAllChromeWindows() {
    try {
        const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class HW {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc e, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@
$chromePids = @(Get-Process chrome -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
[HW]::EnumWindows({
    param($hWnd, $lParam)
    $p = 0
    [HW]::GetWindowThreadProcessId($hWnd, [ref]$p) | Out-Null
    if ($chromePids -contains $p) { [HW]::ShowWindow($hWnd, 0) }
    return $true
}, 0) | Out-Null
    `.trim();
        execSync(ps, {timeout: 5000, shell: 'powershell.exe'});
    } catch (e) { /* ignore */
    }
}

async function getJmCloudflareCookie(browser, page, url, onProgress) {
    let cookie = '';
    let userAgent, cookies, extraHeaders = {}, complete = 0;

    page.on('response', async (resp) => {
        try {
            let title = await page.evaluate(async () => {
                return (document.title || '');
            });
            if (title.includes('502') && title.includes('Bad gateway')) {
                await page.reload();
                return;
            }
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
            for (let key in reqHeaders) {
                if (reqHeaders.hasOwnProperty(key)) {
                    if (key.startsWith('sec-')) {
                        extraHeaders[key] = reqHeaders[key];
                    }
                }
            }
            const body = (await resp.text()) || '';
            if (body.includes('禁漫天堂') || body.includes('个人资料')) {
                userAgent = await page.evaluate(() => navigator.userAgent);
                cookies = await page.cookies();
                await safeClose(page);
            }
        } catch (e) {
        } finally {
            complete += 1;
            onProgress?.(complete, 100);
        }
    });

    await page.goto(url, {
        waitUntil: 'domcontentloaded'
    });

    while (!page.isClosed()) {
        try {
            await page.waitForFunction(() => false, {timeout: 0});
        } catch {
            if (page.isClosed()) break;
        }
    }

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
    let width = 500, height = 700;
    let {
        browser,
        page
    } = await connect({
        headless: false,
        turnstile: true,
        plugins: [],
        defaultViewport: {
            width: width,
            height: height,
        },
        args: [
            `--proxy-server=${proxy}`,
            `--window-size=${width},${height}`,
            '--window-position=-32000,-32000',
            '--disable-translate',
            '--disable-features=Translate,TranslateUI,OptimizationHints',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-infobars',
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages',
            '--disable-background-networking',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
            '--disable-ipc-flooding-protection',
            '--disable-hang-monitor',
            '--disable-prompt-on-repost',
            '--disable-domain-reliability',
            '--disable-sync',
            '--disable-save-password-bubble',
            '--disable-signin-promo',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-features=AutomationControlled,MediaRouter',
            '--enable-features=UserAgentClientHint',
            '--lang=zh-CN',
            '--timezone=Asia/Shanghai',
            '--force-device-scale-factor=1',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--enable-unsafe-swiftshader',
        ],
    });
    await page.setViewport({
        width: width,
        height: height
    });
    // hideAllChromeWindows();
    return {
        browser,
        page
    };
}

module.exports = {
    safeClose,
    connectByPuppeteerRealBrowser,
    getJmCloudflareCookie
};
