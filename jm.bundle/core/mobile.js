const crypto = require('crypto');

// 移动端API密钥
APP_TOKEN_SECRET = '18comicAPP'
APP_TOKEN_SECRET_2 = '18comicAPPContent'
APP_DATA_SECRET = '185Hcomic3PAPP7R'
API_DOMAIN_SERVER_SECRET = 'diosfjckwpqpdfjkvnqQjsik'
APP_VERSION = '2.0.21'

PATTERN_API_RESPONSE_JSON_OBJECT = /\{[\s\S]*?\}/g;

/**
 * 计算禁漫接口的请求headers的token和tokenparam
 *
 * @param ts 时间戳
 * @param ver app版本
 * @param secret 密钥
 * @return (token, tokenparam)
 */
function tokenAndTokenparam(ts, secret = APP_TOKEN_SECRET, ver = APP_VERSION) {
    // tokenparam: 1700566805,1.6.3
    const tokenparam = `${ts},${ver}`;
    // token: 81498a20feea7fbb7149c637e49702e3
    const token = md5hex(`${ts}${secret}`);
    return {
        token, tokenparam
    };
}

/**
 * 解密接口返回值
 *
 * @param {string} data resp.json()['data']
 * @param {number|string} ts 时间戳
 * @param {string} [secret]
 * @return {string} json格式的字符串
 */
function decodeRespData(data, ts, secret) {
    if (secret == null) {
        secret = APP_DATA_SECRET;
    }
    // 1. base64解码
    const dataB64 = Buffer.from(data, 'base64');
    // 2. AES-ECB解密
    const keyHex = md5hex(`${ts}${secret}`);
    const key = Buffer.from(keyHex, 'utf-8'); // ✅ 完全对齐 Python
    const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
    let decrypted = decipher.update(dataB64);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    // 3. 移除末尾的padding
    // const padLen = decrypted[decrypted.length - 1];
    // const result = decrypted.slice(0, -padLen);
    // 4. 解码为字符串 (json)
    let res = decrypted.toString('utf-8');
    return tryParseJsonObject(res);
}

/**
 * @param {string} key
 * @return {string}
 */
function md5hex(key) {
    // key参数需为字符串
    if (typeof key !== 'string') {
        throw new Error('key参数需为字符串');
    }

    return crypto.createHash('md5').update(key, 'utf-8').digest('hex');
}


/**
 * 尝试从响应文本中解析 JSON 对象
 *
 * @param {string} respText
 * @return {object}
 */
function tryParseJsonObject(respText) {
    const text = respText.trim();
    // fast case
    if (text.startsWith('{') && text.endsWith('}')) {
        return JSON.parse(text);
    }
    const pattern = PATTERN_API_RESPONSE_JSON_OBJECT;
    for (const match of text.matchAll(pattern)) {
        try {
            return JSON.parse(match[0]);
        } catch (e) {
            console.error('parse_json_object.error', e);
        }
    }
    throw new Error(
        `未解析出json数据: ${limitText(respText, 200)}`
    );
}

function limitText(text, limit) {
    const length = text.length;
    return length <= limit
        ? text
        : text.slice(0, limit) + `...(${length - limit})`;
}


module.exports = {
    tokenAndTokenparam,
    decodeRespData,
    md5hex
};
