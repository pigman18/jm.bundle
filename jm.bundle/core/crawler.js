'use strict'

const fs = require('node:fs');
const path = require('node:path');
const {pipeline: streamPipeline} = require('stream');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const JSZip = require('jszip');
const {connect} = require('puppeteer-real-browser');
const AsyncLock = require('async-lock');
const lock = new AsyncLock();

const {PHASE, STATE, STEP, ERR} = require('../protocol');
const {retryAndCatch, zipText, unZipText} = require('../../util/common');
const {safeClose} = require('../../util/cloudflare');
const {mergeCookie} = require('../../util/cookie');
const {url2DataPath, saveAxiosResponse, getResponseStream, getAxiosResponseText, withRetry, toQueryString, fetchAllPageData} = require('../../util/http');
const {touchFileSync, writeToFileSync, isNotEmptySync, renameSync} = require('../../util/file');
const {buffer2Base64Image} = require('../../util/image');
const {calcMathCaptcha} = require('../../util/captcha');
const {parseComicRankingPage, parseSerializationList, parseWeekList, parseComicWeekList, parseMeta, parseNumber} = require('./parser');


// ================= JM 客户端 =================
/**
 * JM 模块爬虫
 * @param manifest      JM 模块应用配置
 * @param ctx           上下文对象
 * @param message     JM 模块消息分发器
 * @param config      JM 模块用户配置
 * @return {object}
 */
function createCrawler(manifest, ctx, message, config) {
    // 0、验证码计算错误
    // 1、获取爬虫相关域名
    let {
        host,
        cdnHosts,
        dataDir
    } = config;
    let requestExtraHeaders = {
        'sec-ch-ua-arch': '"x86"'
    };
    let expiresTime = -1;
    // 2、设置 info目录、album_missing目录、episodes目录
    let infoDir = path.join(dataDir, 'info'),                    // 存放漫画基本信息
        infoHtmlDir = path.join(dataDir, 'html'),                // 存放漫画基本信息原始网页（压缩文本）
        comicDir = path.join(dataDir, 'comic'),                  // 存放漫画内容
        fileDir = path.join(dataDir, 'file'),                    // 存放其他数据
        albumMissingDir = path.join(dataDir, 'album_missing');   // 存放无效编码（txt）
    // 3、创建http请求客户端
    let httpClient = createHttpClient();

    /**
     * 创建 http 请求客户端
     */
    function createHttpClient() {
        // 1、创建 http 请求客户端
        let agent = null;
        let proxy = config.proxy || '';
        if (proxy.startsWith('socks5://')) {
            agent = new SocksProxyAgent(proxy);
        } else if (proxy.startsWith('http://')) {
            agent = new HttpsProxyAgent(proxy);
        }
        let httpClient = axios.create({
            httpAgent: agent,
            httpsAgent: agent,
            proxy: false      // 关键：禁用 axios 自带的代理检测
        });
        // 2、设置请求拦截
        httpClient.interceptors.request.use((cfg) => {
            cfg.adapter = 'http'; // ✅ 明确只走 Node
            // 3、实时获取配置中的 userAgent、cookie
            cfg.timeout = config.timeout || 5000;
            cfg.headers['user-agent'] = config.userAgent;
            cfg.headers['cookie'] = config.cookie;
            cfg.headers['accept'] = 'text/html,application/json,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
            // 添加额外请求头
            for (let key in requestExtraHeaders) {
                if (requestExtraHeaders.hasOwnProperty(key)) {
                    cfg.headers[key] = requestExtraHeaders[key];
                }
            }
            return cfg;
        });
        // 4、拦截请求进行处理
        httpClient.interceptors.response.use(
            (response) => {
                // 5、请求成功，模拟浏览器追加 cookie
                if (200 === response.status) {
                    let resCookies = response.headers['set-cookie'] || [];
                    // 响应头的过期时间必须比现在大才能追加
                    for (let resCookie of resCookies) {
                        if (!!resCookie) {
                            let flag1 = resCookie.includes('remember');
                            let flag2 = resCookie.includes(config.username);
                            let flag = !flag1 || (flag1 && flag2);
                            if (flag) {
                                // console.log(`追加 cookie：${resCookie}`);
                                setCookie(mergeCookie(config.cookie, resCookie));
                            }
                        }
                    }
                }
                return response;
            },
            (error) => {
                // ❌ 请求失败
                return Promise.reject(error);
            }
        );
        httpClient.get = withRetry(httpClient.get, 3);
        httpClient.post = withRetry(httpClient.post, 3);
        return httpClient;
    }

    /**
     * 设置额外请求头
     * @param extraHeaders
     */
    function setExtraHeaders(extraHeaders) {
        extraHeaders = extraHeaders || {};
        for (let key in extraHeaders) {
            if (extraHeaders.hasOwnProperty(key)) {
                requestExtraHeaders[key] = extraHeaders[key];
            }
        }
    }

    /**
     * 设置 cookie
     * @param cookie
     */
    function setCookie(cookie) {
        config.setValue('cookie', cookie);
    }

    /**
     * 设置 userAgent
     * @param userAgent
     */
    function setUserAgent(userAgent) {
        config.setValue('userAgent', userAgent);
    }

    /**
     * 统一调用 message 进行消息分发
     * @param payload
     */
    function onMessage(payload) {
        message?.onMessage(payload);
    }

    /**
     * 判断当前是否登录中
     * @return {Promise<boolean>}
     */
    async function isLogin() {
        try {
            // 1、访问【個人資料】页面，如果有@用户名，则说明是登录中
            let res = await httpClient.get(`${config.host}/user/${config.username}/notice`);
            return (res?.data || '').includes(`@${config.username}`);
        } catch (_) {
            return false;
        }
    }

    /**
     * 判断是否 403
     * @return {Promise<boolean>}
     */
    async function is403() {
        try {
            // 1、访问【分類】页，如果状态 403 则需要重新验证 cloudflare
            let res = await httpClient.get(`${config.host}/theme/`);
            return 403 === res.status;
        } catch {
            return true;
        }
    }

    /**
     * 重试
     * @param func
     * @return {Promise<object>}
     */
    async function expireRetry(func) {
        return retryAndCatch(func, async (err) => {
            if (403 === err.status) {
                // 出现403错误，需要重新登录
                await login(err.phase, err.phaseData);
                // 不退出继续重试
                return false;
            }
            if (502 === err.status) {
                // 不退出继续重试
                return false;
            }
            if (404 === err.status) {
                // 直接退出重试
                return true;
            }
            // 退出
            return true;
        });
    }

    /**
     * 获取cloudflare的cookie
     * @param url               指定站点
     * @param proxy             代理地址
     * @param onProgress        进度
     * @return {Promise<{cookie: string, userAgent: string}>}
     */
    async function getJmCloudflareCookie(url,
                                         onProgress,
    ) {
        let {
            proxy,
            headless,
            chromePath
        } = config;
        // 1、拼接配置信息
        let width = 420, height = 560;
        let options = {
            headless: headless || false,
            fingerprint: true, // 注入随机浏览器指纹
            proxy: proxy,
            turnstile: true,
            disableXvfb: false,
            ignoreAllFlags: true,
            args: [
                // '--no-sandbox',
                // '--incognito',   // 无痕模式,
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
            defaultViewport: {
                width: width,
                height: height,
            },
            customConfig:{

            }
        };
        if (!!chromePath && isNotEmptySync(chromePath)) {
            options.customConfig.chromePath = chromePath;
        }
        if (!!proxy) {
            options.args.push(
                `--proxy-server=${proxy}`
            );
        }
        // 2、记录cookie（需要多次拼接）
        let cookie = '';
        // 2、打开页面
        const {browser, page} = await connect(options);
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
        page.on('response', async (resp) => {
            let req = resp.request();
            let method = req.method();
            let url = resp.url();
            let reqHeaders = req.headers() || {};
            let respHeaders = resp.headers() || {};
            let reqCookie = reqHeaders['cookie'];
            let respCookie = respHeaders['set-cookie'];
            // 4、累加请求到的cookie
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
            // console.log(`[${method}]${url}`);
            // 判断是否502
            try {
                let title = await page.evaluate(async () => {
                    return (document.title || '');
                });
                if (title.includes('502') && title.includes('Bad gateway')) {
                    await page.reload();
                }
            } catch (e) {

            }
            try {
                const body = (await resp.text()) || '';
                if (body.includes('禁漫天堂') || body.includes('个人资料')) {
                    // 8、获取 cookie、userAgent
                    userAgent = await browser.userAgent();
                    let cookies1 = await browser.cookies();
                    let cookies2 = await page.cookies();
                    cookies = [
                        ...(cookies1 || []),
                        ...(cookies2 || [])
                    ];
                    // 9、关闭页面
                    await safeClose(page, {});
                }
            } catch (e) {

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

    /**
     * 进行 JM 登录（有锁）
     * 1、通过 cloudflare 校验，获取 cf_clearance、ipcountry、ipm5、theme=light、AVS、sticky 这些 cookie 头
     * 2、GET 访问/albums/meiman 页面，会返回 set-cookie，ipcountry、ipm5
     * 3、POST 请求/login 接口，继续追加 cookie
     * 4、再次跳转会/albums/meiman 页面
     * @return {Promise<{cookie, userAgent, username}|*>}
     */
    async function login(phase = PHASE.LOGIN, phaseData = {}) {
        phase = phase || PHASE.LOGIN;
        phaseData = phaseData || {};
        // 1、定义使用到的页面、api
        let PAGE_INDEX = `${config.host}/albums/meiman`;
        let PAGE_LOGIN = `${config.host}/login`;
        let API_LOGIN = `${config.host}/login`;
        return await message.doLockPhase(phase, async (stepHandler) => {
            // 2、定义步骤过程
            let steps = {
                // 2.1、检查当前用户名密码是否有填写
                [STEP.CHECK_LOGIN_PARAMS]: async () => {
                    return await stepHandler.doStep(STEP.CHECK_LOGIN_PARAMS, async () => {
                        return new Promise((resolve, reject) => {
                            // 1、定时验证用户名密码是否有填写，否则则不会进入登录流程
                            const check = () => {
                                if (config.username && config.password) {
                                    resolve();
                                } else {
                                    // 通知前端
                                    onMessage({
                                        phase: PHASE.LOGIN,
                                        stepL: STEP.CHECK_LOGIN_PARAMS,
                                        state: STATE.ERROR,
                                        error: ERR.LOGIN_NO_CREDENTIAL

                                    });
                                    setTimeout(check, 1000);
                                }
                            };
                            check();
                        });
                    });
                },
                // 2.2、通过 CloudflareCookie 校验
                [STEP.CLOUD_FLARE_COOKIE]: async () => {
                    return await stepHandler.doStep(STEP.CLOUD_FLARE_COOKIE, async (stepMessageData, onProgress) => {
                        // 1、访问出现 403，则需要验证 cloudflare
                        let is403Flag = await is403();
                        if (is403Flag) {
                            // 2、请求 Cloudflare 的 cookie
                            let {
                                userAgent,
                                cookie,
                                extraHeaders
                            } = await getJmCloudflareCookie(
                                PAGE_LOGIN,
                                onProgress
                            );
                            // 3、追加（覆盖）到当前 cookie 中
                            setUserAgent(userAgent);
                            setCookie(mergeCookie(config.cookie, cookie));
                            setExtraHeaders(extraHeaders);
                        }
                        return {
                            userAgent: config.userAgent,
                            cookie: config.cookie
                        };
                    });
                },
                // 2.3、请求登录接口
                [STEP.LOGIN_API]: async () => {
                    // 模拟点击了主站的弹窗
                    setCookie(mergeCookie(config.cookie, 'cover=1; guide=1'));
                    return await stepHandler.doStep(STEP.LOGIN_API, async () => {
                        let oldCookie = config.cookie;
                        let formData = new FormData();
                        formData.append("username", config.username);
                        formData.append("password", config.password);
                        formData.append("submit_login", String(1));
                        // 记住密码 +180 天
                        formData.append("id_remember", "on");
                        formData.append("login_remember", "on");
                        let apiResponse = await httpClient.post(API_LOGIN, formData, {
                            'content-type': 'application/x-www-form-urlencoded'
                        });
                        if (apiResponse.status !== 200) {
                            throw ERR.LOGIN_API_FAILED;
                        }
                        return {
                            oldCookie: oldCookie,
                            newCookie: config.cookie
                        };
                    });
                },
                // 2.4、请求首页
                [STEP.INDEX_PAGE]: async () => {
                    return await stepHandler.doStep(STEP.INDEX_PAGE, async () => {
                        let res = await httpClient.get(PAGE_INDEX);
                        return {
                            status: res.status,
                            data: res.data
                        }
                    });
                }
            };
            // 3、判断当前是否登录中
            let isUserLogin = await isLogin();
            if (!isUserLogin) {
                setCookie('');
                // 4、执行步骤过程
                await steps[STEP.CHECK_LOGIN_PARAMS]();
                await steps[STEP.CLOUD_FLARE_COOKIE]();
                // await steps[STEP.INDEX_PAGE]();
                await steps[STEP.LOGIN_API]();
                // await steps[STEP.INDEX_PAGE]();
            }
            return {
                username: config.username,
                userAgent: config.userAgent,
                cookie: config.cookie,
                ...phaseData
            };
        }, phaseData);
    }

    /**
     * 签到
     * @return {Promise<void>}
     */
    async function sign() {

    }

    /**
     * 拉取漫画基本信息原始网页（base64 压缩）
     * @param number
     * @param phase
     * @return {Promise<*>}
     */
    async function fetchAlbumHtml(number, phase = PHASE.FETCH_INFO_HTML) {
        // 1、定义使用到的页面、api
        let PAGE_INFO = `${config.host}/album/${number}/`;
        return await message.doPhase(phase || PHASE.FETCH_INFO_HTML, async (stepHandler) => {
            // 3、请求详情页内容
            let res = await httpClient.post(PAGE_INFO, {});
            let html = (res.data || '').trim();
            // 4、网页内容为空时，需要清空当前 cookie 登录后再请求
            if (!html) {
                setCookie('');
                await login();
                return fetchAlbumHtml(number);
            }
            if (html.includes("album_missing")) {
                // 5、漫画信息不存在
                return {
                    success: false,
                    number,
                    html: ''
                }
            }
            return {
                success: true,
                number,
                html
            };
        }, {number});
    }

    /**
     * 获取预先要存放的结果
     * @param number
     * @return {object}
     */
    function getPreResult(number) {
        return {
            htmlFile: `${infoHtmlDir}/${number}.txt`,
            infoFile: `${infoDir}/${number}.json`,
            coverFile: `${fileDir}/${host.split('https://').join('').split('http://').join('')}/media/albums${number}.jpg`,
            comicFile: `${comicDir}/${number}.zip`,
        }
    }

    /**
     * 拉取漫画
     * 原理：以 https://18comic.vip/album_download/645130 为例
     * 1、页面一进来，实际就直接请求了 https://18comic.vip/captcha/ 验证码接口
     * 2、点击倒计时，其实就是把请求的验证码显示出来而已，如果自己单独请求了验证码接口，把获取到的内容填入后也是可以用的
     * 3、接下来请求接口
     * [POST]https://18comic.vip/album_download/645130
     * params:
     *  album_id: 645130
     *  verification: 验证码结果
     * headers:
     *  content-type: application/x-www-form-urlencoded
     * 会进行 301 转发，拿到 Location 就是下载文件地址
     * @param number
     * @param targetStream
     * @param phase
     * @param withDownloadQueue 是否使用下载队列
     * @return {Promise<null|*>}
     */
    async function downloadAlbumArchive(number, targetStream, phase = PHASE.FETCH_COMIC, afterSteps = null) {
        // 1、定义使用到的页面、api
        let PAGE_DOWNLOAD = `${config.host}/album_download/${number}`,
            API_CAPTCHA = `${host}/captcha/`,
            API_DOWNLOAD = `${host}/album_download/${number}`;
        // 2、执行下载流程
        return await message.doPhase(phase || PHASE.FETCH_COMIC, async (stepHandler, phaseMessageData) => {
            // 4、开始下载
            number = Number(number);
            // 5、定义步骤过程
            let steps = {
                // 2.1、请求下载页，0表示没数据，1表示有数据
                [STEP.DOWNLOAD_PAGE]: async () => {
                    return await stepHandler.doStep(STEP.DOWNLOAD_PAGE, async (stepMessageData) => {
                        let downloadPage = await httpClient.get(PAGE_DOWNLOAD);
                        let htmlText = downloadPage.data || '';
                        // 2、漫画不存在
                        if (htmlText.includes('非常抱歉，目前此本漫畫因上傳者不提供下載')) {
                            throw ERR.COMIC_NOT_FOUND;
                        }
                        if (htmlText.includes('無效A漫連結或下載已關閉，謝謝。!')) {
                            throw ERR.COMIC_NOT_FOUND;
                        }
                        if (!htmlText.includes(number)) {
                            throw ERR.COMIC_NOT_FOUND;
                        }
                        return {
                            status: 1
                        }
                    }, {number});
                },
                // 2、计算验证码（主动带重试）
                [STEP.CAPTCHA]: async () => {
                    let retryCount = null;
                    return await stepHandler.doStep(STEP.CAPTCHA, async (stepMessageData, onProgress) => {
                        const res = await httpClient.get(API_CAPTCHA, {
                            responseType: 'arraybuffer' // ✅ Node 用这个
                        });
                        // 2、获取图片buffer
                        const buffer = Buffer.from(res.data);
                        // 3、转换base64，方便查看
                        let base64Image = buffer2Base64Image(buffer);
                        // 4、设置阈值
                        let thresholds = [60, 80, 100, 120, 140, 160, 180, 200, 220];
                        return retryAndCatch(async () => {
                            if (null !== retryCount) {
                                onProgress(retryCount * 10, 100);
                            }
                            // 4、验证码 OCR：语言包默认走 CDN（CaptchaUtil 内 langPath）
                            let threshold = thresholds[retryCount || 0];
                            let correctResult = await calcMathCaptcha(buffer, {
                                // 传入随机值
                                threshold: threshold
                            });
                            // 5、无结果或计算表达式不对，进行重试
                            if (!correctResult?.verification) {
                                // 抛出异常进行重试
                                throw ERR.RETRY_CAPTCHA_ERROR;
                            }
                            onProgress(100, 100);
                            return {
                                threshold: threshold,
                                captcha: base64Image,
                                text: correctResult.text,
                                mathText: correctResult.mathText,
                                verification: correctResult.verification
                            }
                        }, (err, c) => {
                            retryCount = c;
                        }, 10);
                    }, {number, retryCount})
                },
                // 3、请求漫画真实下载链接
                [STEP.REAL_LINK]: async (captcha, verification) => {
                    return await stepHandler.doStep(STEP.REAL_LINK, async (stepMessageData, onProgress) => {
                        let formData = new FormData();
                        formData.append("album_id", String(number));
                        formData.append("verification", String(verification));
                        let response = await httpClient.post(API_DOWNLOAD, formData, {
                            headers: {
                                'content-type': 'application/x-www-form-urlencoded'
                            },
                            responseType: 'stream'
                        });
                        if ((response.headers['content-type'] || '').indexOf('zip') === -1) {
                            // 1、非 zip，获取文本
                            let htmlText = await getAxiosResponseText(response);
                            htmlText = htmlText || '';
                            if (!htmlText.includes(config.username)) {
                                throw ERR.LOGIN_EXPIRE;
                            }
                            if (htmlText.includes('JCoin兌換')) {
                                throw ERR.COMIC_PAY_ERROR;
                            }
                            throw ERR.RETRY_CAPTCHA_ERROR;
                        }
                        let realUrl = `${response.request.protocol}//${response.request.host}/${response.request.path.substring(1)}`;
                        // ✅ 关键：立刻关
                        try {
                            response.data.destroy();
                            response.request.destroy();
                        } catch (e) {
                            console.log(e)
                        }
                        return {
                            url: realUrl
                        }
                    }, {number, verification});
                },
                // 4、下载漫画
                [STEP.DOWNLOAD]: async (realUrl) => {
                    return await stepHandler.doStep(STEP.DOWNLOAD, async (stepMessageData, onStepProgress) => {
                        let response = await httpClient.get(realUrl, {
                            responseType: 'stream'
                        });
                        let finalComplete = 0, finalTotal = 0;
                        let stream = await getResponseStream(response, {
                            filename: `${number}`,
                            onProgress: ({complete, total}) => {
                                onStepProgress(complete, total);
                                finalComplete = complete;
                                finalTotal = total;
                            }
                        });
                        await new Promise((resolve, reject) => {
                            streamPipeline(stream, targetStream, err => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                        if (afterSteps) {
                            await afterSteps({ number, complete: finalComplete, total: finalTotal });
                        }
                        return {
                            complete: finalComplete,
                            total: finalTotal
                        }
                    }, {number});
                }
            };
            // 4、执行步骤过程
            // await steps[STEP.DOWNLOAD_PAGE]();
            // 同时间只能请求1个验证码
            try {
                let url = await lock.acquire('captcha-real-link', async () => {
                    let {captcha, verification} = await steps[STEP.CAPTCHA]();
                    let {url} = await steps[STEP.REAL_LINK](captcha, verification);
                    return url;
                });
                let {complete, total} = await steps[STEP.DOWNLOAD](url);
                return {
                    number,
                    complete,
                    total
                }
            } catch (e) {
                e.phase = PHASE.FETCH_COMIC;
                e.phaseData = {
                    number
                }
                throw e;
            }
        });
    }

    /**
     * 远程下载文件到本地
     * @param {string} url
     * @param {boolean} [force] 为 true 时强制重新下载
     * @returns {Promise<string>}
     */
    async function fetchRemoteFile(url, force = false) {
        // 1、校验链接
        url = (url || '').trim();
        if (!url) {
            return null;
        }
        let dataPath = url2DataPath(url, fileDir, false);
        if (isNotEmptySync(dataPath)) {
            return dataPath;
        }
        let {
            file
        } =  await message.doPhase(PHASE.FETCH_FILE, async (stepHandler, phaseMessageData) => {
            // 1、进行文件下载
            return await expireRetry(async () => {
                const response = await httpClient.get(url, {
                    responseType: 'stream',
                });
                await saveAxiosResponse(response, dataPath);
                return {
                    file: dataPath
                }
            });
        });
        return file;
    }

    /**
     * 拉取漫画信息分页，适用于以下链接：
     * 漫画-总排行    https://18comic.vip/albums?o=mv
     * 漫画分类-单人  https://18comic.vip/albums/single
     * 分类-恋爱     https://18comic.vip/search/photos?search_query=恋爱
     * 关键字搜索    https://18comic.vip/search/photos?search_query=明日方舟&search-type=photos&main_tag=0
     * @param url   {string}                      基础链接
     * @param label {string}                      文本标记
     * @param page  {number}                      开始读取分页
     * @param onPage {function}                   数据回调
     * @return {Promise<void>}
     */
    async function pageAlbums(url, label, onPage, page = 1) {
        return await message.doPhase(PHASE.FETCH_COMIC_PAGE, async (stepHandler, phaseMessageData) => {
            // 1、注册步骤
            let steps = {
                [STEP.FETCH_COMIC_PAGE_DETAILS]: async (pageNum) => {
                    return await stepHandler.doStep(STEP.FETCH_COMIC_PAGE_DETAILS, async (stepMessageData, onProgress) => {
                        if (!url) {
                            return {
                                list: [],
                                pages: 0,
                                page: pageNum
                            };
                        }
                        // 1、拼接请求参数
                        let queryString = toQueryString({page: pageNum});
                        if (url.includes('?')) {
                            url = `${url}&${queryString}`;
                        } else {
                            url = `${url}?${queryString}`;
                        }
                        // 2、请求html内容
                        const res = await httpClient.get(url);
                        let html = res?.data || '';
                        if (!html) {
                            // 登录失效
                            throw ERR.LOGIN_EXPIRE;
                        }
                        // 3、解析page
                        let comicRankingPage = parseComicRankingPage(html);
                        onProgress(comicRankingPage.pagination.currentPage, comicRankingPage.pagination.totalPages);
                        return {
                            list: comicRankingPage.list,
                            pages: comicRankingPage.pagination.totalPages,
                            page: comicRankingPage.pagination.currentPage
                        }
                    }, {page: pageNum});
                }
            };
            // 2、加载全部分页
            await fetchAllPageData(async (pageNum) => {
                let pageInfo;
                let file = `${manifest.workspace}/temp/${label}/${new Date().format('yyyyMMdd')}_${pageNum}.json`;
                if (fs.existsSync(file)) {
                    pageInfo = JSON.parse(fs.readFileSync(file, 'utf-8'));
                } else {
                    pageInfo = await expireRetry(() => steps[STEP.FETCH_COMIC_PAGE_DETAILS](pageNum));
                    writeToFileSync(file, JSON.stringify(pageInfo));
                }
                await onPage(pageInfo);
                return pageInfo;
            }, page);
        });
    }

    /**
     * 拉取漫画每周连载更新，适用于以下链接
     * https://18comic.vip/serialization/0
     * https://18comic.vip/serialization/1
     * @return {Promise<void>}
     */
    async function listSerialsAlbums(url, label, onList) {
        return await message.doPhase(PHASE.FETCH_SERIALIZATION, async (stepHandler, phaseMessageData) => {
            return await expireRetry(async () => {
                {
                    if (!url) {
                        return {
                            list: [],
                            label: label
                        };
                    }
                    // 1、请求html内容
                    const res = await httpClient.get(url);
                    let html = res?.data || '';
                    if (!html) {
                        // 登录失效
                        throw ERR.LOGIN_EXPIRE;
                    }
                    // 2、解析page
                    let list = parseSerializationList(html);
                    await onList(label, list);
                    return {
                        list: list,
                        label: label
                    }
                }
            })
        });
    }

    /**
     * 拉取漫画每周必看
     * https://18comic.vip/week#comicRanking
     * @param onPage
     */
    async function pageWeeklyAlbums(onPage = async (pageInfo) => {
    }) {
        let complete = 0;
        return await message.doPhase(PHASE.FETCH_COMIC_WEEK, async (stepHandler, phaseMessageData) => {
            // 1、注册步骤
            let steps = {
                // 1.1、请求每周必看列表
                [STEP.FETCH_COMIC_WEEK_LIST]: async () => {
                    return await stepHandler.doStep(STEP.FETCH_COMIC_WEEK_LIST, async (stepMessageData, onProgress) => {
                        let res = await httpClient.get(`${config.host}/week#comicRanking`);
                        let html = res?.data || '';
                        if (!html) {
                            // 登录失效
                            throw ERR.LOGIN_EXPIRE;
                        }
                        return {
                            weekList: parseWeekList(html)
                        }
                    });
                },
                // 1.2、请求每周必看
                /**
                 * {
            "id": 240,
            "title": "",
            "time": "2026第239\n                    期 05.15 - 05.08",
            "year": 2026,
            "issue": 239,
            "start": "2026-05-07T16:00:00.000Z",
            "end": "2026-05-14T16:00:00.000Z",
            "startStr": "2026-05-08",
            "endStr": "2026-05-15",
            "url": "https://18comic.vip/week/240"
          }
                 * @param weekData
                 * @return {Promise<void>}
                 */
                [STEP.FETCH_COMIC_WEEK]: async (weekData, total) => {
                    return await stepHandler.doStep(STEP.FETCH_COMIC_WEEK, async (stepMessageData, onProgress) => {
                        if (!weekData.url) {
                            return {};
                        }
                        let res = await httpClient.get(weekData.url);
                        let html = res?.data || '';
                        if (!html) {
                            // 登录失效
                            throw ERR.LOGIN_EXPIRE;
                        }
                        let comicWeekList = parseComicWeekList(html);
                        complete += 1;
                        return {
                            list: comicWeekList,
                            complete,
                            total,
                            page: weekData.id,
                            pages: total,
                            weekData: weekData
                        }
                    }, {text: `【${weekData.time}${weekData.title ? ':' + weekData.title : ''}】`});
                }
            };
            // 2、请求周数列表
            let {
                weekList
            } = await expireRetry(() => steps[STEP.FETCH_COMIC_WEEK_LIST]());
            // 3、请求每期每周必看
            for (let weekData of (weekList || [])) {
                let pageInfo;
                let file = `${manifest.workspace}/temp/week/${weekData.id}.json`;
                if (fs.existsSync(file)) {
                    pageInfo = JSON.parse(fs.readFileSync(file, 'utf-8'));
                } else {
                    pageInfo = await expireRetry(() => steps[STEP.FETCH_COMIC_WEEK](weekData, weekList.length));
                    writeToFileSync(file, JSON.stringify(pageInfo));
                }
                weekList.list = pageInfo.list;
                await onPage(pageInfo);
            }
            return {
                weekList
            };
        });
    }

    /**
     * 往zip注入漫画内容文件
     * @param zipPath
     * @param xml
     * @return {Promise<void>}
     */
    async function injectComicInfo(zipPath, xml) {
        const buf = fs.readFileSync(zipPath);
        let zip;
        try {
            zip = await JSZip.loadAsync(buf);
        } catch (e) {
            console.error(`[injectComicInfo] JSZip.loadAsync 失败: ${e.message}`);
            throw e;
        }

        zip.file('ComicInfo.xml', xml, {
            compression: 'DEFLATE'
        });
        let out;
        try {
            out = await zip.generateAsync({
                type: 'nodebuffer',
                compression: 'DEFLATE',
                platform: 'DOS'
            });
        } catch (e) {
            console.error(`[injectComicInfo] zip.generateAsync 失败: ${e.message}`);
            throw e;
        }
        try {
            fs.writeFileSync(zipPath, out);
        } catch (e) {
            console.error(`[injectComicInfo] 写入文件失败 (文件被占用): ${e.message}`);
            throw e;
        }
    }

    async function init() {
        await login();
    }

    async function close() {

    }

    let account = {
        login: login,
        sign: sign
    };

    let album = {
        // 获取漫画元信息
        getMeta: async (number, phase = PHASE.FETCH_INFO_HTML) => {
            number = parseNumber(number);
            let htmlFile = `${infoHtmlDir}/${number}.txt`;
            let html = '';
            if (isNotEmptySync(htmlFile)) {
                // 1、本地文件存在时，解压本地文件
                html = unZipText(fs.readFileSync(htmlFile, 'utf-8'));
            } else {
                // 2、请求最新内容
                let htmlResult = await expireRetry(() => fetchAlbumHtml(number, phase));
                html = htmlResult.html;
            }
            if (!html) {
                throw ERR.INFO_NOT_FOUND;
            }
            // 3、保存漫画压缩内容
            writeToFileSync(htmlFile, zipText(html));
            // 4、转换基本信息
            let meta = parseMeta(html);
            if (!!meta) {
                if (meta.aid !== number) {
                    // 实际编码和请求编码不一致，说明是跳转的
                    meta.redirect = meta.aid;
                }
                // 兼容之前的数据
                meta.number = number;
                (meta.episodes || []).forEach((episode) => {
                    episode.number = episode.aid;
                });
                return meta;
            }
            throw ERR.INFO_NOT_FOUND;
        },
        // 下载漫画压缩包
        downloadArchive: async (number, withAppendComicInfo = true, afterSteps = null) => {
            number = parseNumber(number);
            let archiveFile = `${comicDir}/${number}.zip`;
            let archiveFileBak = archiveFile + '.bak';
            touchFileSync(archiveFileBak);
            if (isNotEmptySync(archiveFile)) {
                let st = fs.statSync(archiveFile);
                return {
                    file: archiveFile,
                    complete: st.size,
                    total: st.size,
                };
            }
            let {
                complete,
                total
            } = await expireRetry(() => downloadAlbumArchive(number, fs.createWriteStream(archiveFileBak)));
            if (!!total) {
                try {
                    renameSync(archiveFileBak, archiveFile);
                    if (afterSteps) {
                        await afterSteps({ number, file: archiveFile, complete, total });
                    }
                    return {
                        file: archiveFile,
                        complete: complete,
                        total: total,
                    };
                } catch (e) {
                    fs.rmSync(archiveFileBak);
                }
            }
            throw ERR.COMIC_NOT_FOUND;
        },

        /**
         * 追加漫画信息到压缩包
         * @param info               漫画元信息（含 episodes）
         * @param file               漫画文件
         * @return {Promise<void>}
         */
        appendComicInfo2Archive: async (info, file) => {
            if (!isNotEmptySync(file)) {
                console.error(`[appendComicInfo2Archive] 文件为空: ${file}`);
                return;
            }
            let {
                aid,
                episodes,
                title,
                description,
                authors,
                uploader,
                allTags,
                tags
            } = info;
            let comicInfo = {
                title: '',
                number: 1,
                series: '',
                summary: '',
                writer: '',
                penciller: '',
                publisher: '',
                genre: '',
                tags: '',
                web: '',
                languageIso: 'zh'
            };
            // 1、填充漫画介绍文件
            comicInfo.series = `${title}`;
            comicInfo.summary = description;
            comicInfo.writer = (authors || []).join(',');
            comicInfo.penciller = (authors || []).join(',');
            comicInfo.publisher = uploader;
            comicInfo.genre = (allTags || []).join(',');
            comicInfo.tags = (tags || []).join(',');
            const albumNumber = info.number || aid;
            // 从文件名中提取实际编号（子集下载时 file 是子集编号）
            const fileNumber = Number(path.basename(file, '.zip'));
            comicInfo.web = `${host}/album/${albumNumber}/`;
            // 2、子标题的特殊处理
            if (fileNumber !== albumNumber && !!episodes && episodes.length > 0) {
                let ep = episodes.filter((obj) => obj.aid === fileNumber || obj.number === fileNumber)[0];
                if (!ep) {
                    console.error(`匹配信息失败，麻烦自行查找：${fileNumber}`);
                    return;
                }
                comicInfo.title = `${title}：${ep.title}`;
                comicInfo.number = ep.index + 1;
            } else {
                comicInfo.title = `${title}`;
                comicInfo.number = 1;
            }
            // 4、拼接xml内容
            let comicInfoXml = `<?xml version="1.0" encoding="UTF-8"?>
<ComicInfo>
  <Title>${comicInfo.title}</Title>
  <Series>${comicInfo.series}</Series>
  <Number>${comicInfo.number}</Number>
  <Summary>${comicInfo.summary}</Summary>

  <!-- ===== 创作与出版人员（字符串类型，多人可用英文逗号分隔） ===== -->
  <Writer>${comicInfo.writer}</Writer>
  <Penciller>${comicInfo.penciller}</Penciller>
  <Publisher>${comicInfo.publisher}</Publisher>

  <!-- ===== 分类与标签（字符串类型，多值用英文逗号分隔） ===== -->
  <Genre>${comicInfo.genre}</Genre>
  <Tags>${comicInfo.tags}</Tags>

  <!-- ===== 网址与扫描信息 ===== -->
  <Web>${comicInfo.web}</Web>

  <!-- ===== 语言与格式 ===== -->
  <LanguageISO>${comicInfo.languageIso}</LanguageISO>
</ComicInfo>`;
            // 5、写入压缩包
            await injectComicInfo(file, comicInfoXml);
        }
    };
    let search = {
        // 关键字搜索
        byKeyword: async (keyword) => {
            let url = `https://18comic.vip/search/photos?search_query=${keyword}&search-type=photos&main_tag=0`;
            let label = `关键字搜索-${keyword}`;
            return expireRetry(async () => {
                let albums = [];
                await pageAlbums(url, label, async (pageInfo) => {
                    albums.push(...(pageInfo.list || []));
                });
                return albums;
            });
        }
    };
    let rank = {
        // 每周必看
        weekly: async () => {
            return expireRetry(async () => {
                let albums = [];
                await pageWeeklyAlbums(async (pageInfo) => {
                    albums.push(...(pageInfo.list || []));
                });
                return albums;
            });
        },
        // 每周最新连载
        serials: async () => {
            let all = {
                "SERIALIZATION_0": {
                    "label": "每周連載更新（已完结）",
                    "url": "https://18comic.vip/serialization/0"
                },
                "SERIALIZATION_1": {
                    "label": "每周連載更新（周一）",
                    "url": "https://18comic.vip/serialization/1"
                },
                "SERIALIZATION_2": {
                    "label": "每周連載更新（周二）",
                    "url": "https://18comic.vip/serialization/2"
                },
                "SERIALIZATION_3": {
                    "label": "每周連載更新（周三）",
                    "url": "https://18comic.vip/serialization/3"
                },
                "SERIALIZATION_4": {
                    "label": "每周連載更新（周四）",
                    "url": "https://18comic.vip/serialization/4"
                },
                "SERIALIZATION_5": {
                    "label": "每周連載更新（周五）",
                    "url": "https://18comic.vip/serialization/5"
                },
                "SERIALIZATION_6": {
                    "label": "每周連載更新（周六）",
                    "url": "https://18comic.vip/serialization/6"
                },
                "SERIALIZATION_7": {
                    "label": "每周連載更新（周日）",
                    "url": "https://18comic.vip/serialization/7"
                }
            };
            let list = [];
            for (let key in all) {
                let c = all[key];
                await expireRetry(async () => {
                    await listSerialsAlbums(c.url, c.label, (pageInfo) => {
                        list.push(...(pageInfo.list || []));
                    });
                })
            }
            return list;
        }
    };

    return {
        httpClient,
        isLogin,
        getPreResult,
        close,
        init,
        fetchRemoteFile,
        account,
        album,
        search,
        rank,
    };
}

module.exports = {
    createCrawler
};
