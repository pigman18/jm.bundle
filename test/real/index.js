const {chromium} = require('playwright');
const {pageController} = require("./module/pageController.js");
let Xvfb
try {
    Xvfb = require("xvfb");
} catch {
    // ignore
}

async function connect({
                           args = [],
                           headless = false,
                           customConfig = {},
                           proxy = {},
                           turnstile = false,
                           connectOption = {},
                           disableXvfb = false,
                           plugins = [],
                           ignoreAllFlags = false,
                       } = {}) {
    const {Launcher} = await import("chrome-launcher");

    let xvfbsession = null;
    if (headless == "auto") headless = false;

    if (process.platform === "linux" && disableXvfb === false) {
        try {
            xvfbsession = new Xvfb({
                silent: true,
                xvfb_args: ["-screen", "0", "1920x1080x24", "-ac"],
            });
            xvfbsession.startSync();
        } catch (err) {
            console.log(
                "You are running on a Linux platform but do not have xvfb installed. The browser can be captured. Please install it with the following command\n\nsudo apt-get install xvfb\n\n" +
                err.message
            );
        }
    }

    let chromeFlags;
    if (ignoreAllFlags === true) {
        chromeFlags = [
            ...args,
            ...(headless !== false ? [`--headless=${headless}`] : []),
            ...(proxy && proxy.host && proxy.port
                ? [`--proxy-server=${proxy.host}:${proxy.port}`]
                : []),
        ];
    } else {
        // Default flags: https://github.com/GoogleChrome/chrome-launcher/blob/main/src/flags.ts
        const flags = Launcher.defaultFlags();
        // Add AutomationControlled to "disable-features" flag
        const indexDisableFeatures = flags.findIndex((flag) => flag.startsWith('--disable-features'));
        flags[indexDisableFeatures] = `${flags[indexDisableFeatures]},AutomationControlled`;
        // Remove "disable-component-update" flag
        const indexComponentUpdateFlag = flags.findIndex((flag) => flag.startsWith('--disable-component-update'));
        flags.splice(indexComponentUpdateFlag, 1);
        chromeFlags = [
            ...flags,
            ...args,
            ...(headless !== false ? [`--headless=${headless}`] : []),
            ...(proxy && proxy.host && proxy.port
                ? [`--proxy-server=${proxy.host}:${proxy.port}`]
                : []),
            "--no-sandbox",
            "--disable-dev-shm-usage",
        ];
    }

    const browser = await chromium.launch({
        headless: false,
        channel: 'chrome', // 如果有真实 Chrome 可用,
        args: [
            ...chromeFlags
        ]
    })

    const context = await browser.newContext({
        viewport: {width: 1920, height: 1080},
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai'
    })

    const page = await context.newPage()


    let pageControllerConfig = {
        browser,
        page,
        proxy,
        turnstile,
        xvfbsession,
        // pid: browser.process().pid,
        plugins,
    };

   await pageController({
        ...pageControllerConfig,
        killProcess: true,
        // chrome,
    });

    browser.on("targetcreated", async (target) => {
        if (target.type() === "page") {
            let newPage = await target.page();
            pageControllerConfig.page = newPage;
            newPage = await pageController(pageControllerConfig);
        }
    });

    return {
        browser,
        page,
    };
}

module.exports = {connect};
