const {mergeCookie} = require('../util/cookie');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const axios = require('axios');
const {tokenAndTokenparam, decodeRespData} = require('../jm.bundle/core/mobile');

/**
 * 创建 http 请求客户端
 */
function createHttpClient(config) {
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
                            config.cookie = mergeCookie(config.cookie, resCookie);
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
    return httpClient;
}

APP_TOKEN_SECRET = '18comicAPP'
APP_TOKEN_SECRET_2 = '18comicAPPContent'

function decide_headers_and_ts(uri) {
    // 获取时间戳
    let ts = new Date().getTime();
    let {
        token,
        tokenparam
    } = tokenAndTokenparam(ts, uri === '/chapter_view_template' ? APP_TOKEN_SECRET_2 : APP_TOKEN_SECRET);
    //  设置headers
    return {
        ts: ts,
        headers: {
            'token': token,
            'tokenparam': tokenparam,
        }
    }
}

(async () => {
    let config = {
        userAgent: 'Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36',
        username: 'pigman17',
        password: 'qq123456',
        proxy: 'http://127.0.0.1:10809'
    };
    let httpClient = createHttpClient(config);
    let formData = new FormData();
    formData.append("username", config.username);
    formData.append("password", config.password);
    formData.append("submit_login", String(1));
    // 记住密码 +180 天
    formData.append("id_remember", "on");
    formData.append("login_remember", "on");
    let apiResponse = await httpClient.post('https://www.cdnhjk.net/login', formData);
    if (apiResponse.status !== 200) {
        throw ERR.LOGIN_API_FAILED;
    }
    let uri = '/album?id=1000276';
    let {
        ts,
        headers
    } = decide_headers_and_ts(uri);
    let resp2 = await httpClient.get(`https://www.cdnhjk.net${uri}`, {
        headers: {
            ...headers,
            userAgent: config.userAgent,
            cookie: config.cookie
        }
    });
    let data = decodeRespData(resp2?.data?.data || '', ts);
    return {
        newCookie: config.cookie
    };
})();
