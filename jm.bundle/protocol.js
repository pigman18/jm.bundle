// protocol.js 运行协议
'use strict'

/**
 * 任务阶段（我在干什么）
 */
let PHASE = {
    LOGIN: 'login',
    GET_META: 'get_meta',
    FETCH_INFO_HTML: 'fetch_info_html',
    FETCH_COMIC: 'fetch_comic',
    FETCH_FILE: 'fetch_file',
    FETCH_COMIC_PAGE: 'fetch_comic_page',
    FETCH_SERIALIZATION: 'fetch_serialization',
    FETCH_COMIC_WEEK: 'fetch_comic_week',
    // local->db, db->local
    SYNC_LOCAL_TO_DB: 'sync_local_to_db',
    SYNC_DB_TO_LOCAL: 'sync_db_to_local',
};

/**
 * 任务子步骤
 */
let STEP = {
    // login
    CHECK_LOGIN_PARAMS: 'check_login_params',
    CLOUD_FLARE_COOKIE: 'cloud_flare_cookie',
    LOGIN_API: 'login_api',
    INDEX_PAGE: 'index_page',
    // fetch info
    INFO_PAGE: 'info_page',
    // fetch comic
    DOWNLOAD_PAGE: 'download_page',
    CAPTCHA: 'captcha',
    REAL_LINK: 'real_link',
    DOWNLOAD: 'download',
    APPEND_COMIC_INFO: 'append_comic_info',
    // fetch file
    FILE: 'file',
    // fetch comic ranking
    FETCH_COMIC_PAGE_DETAILS: 'fetch_comic_page_details',
    // fetch comic week
    FETCH_COMIC_WEEK_LIST: 'fetch_comic_week_list',
    FETCH_COMIC_WEEK: 'fetch_comic_week',
}


/**
 * 运行状态（做到哪了）
 */
let STATE = {
    IDLE: 'idle',       // 还没开始
    WAITING: 'waiting', // 已入队，等执行
    START: 'start',     // 刚开始
    RUNNING: 'running', // 执行中
    SUCCESS: 'success', // 成功
    ERROR: 'error',     // 失败
};

/**
 * 错误码（为什么失败）
 */
let ERR = {
    LOGIN_NO_CREDENTIAL: {code: -10, message: '麻烦填写用户名和密码', status: 502},
    LOGIN_API_FAILED: {code: -11, message: '请求登录接口异常', status: 502},
    LOGIN_MEIMAN_FAILED: {code: -12, message: '请求门户页异常', status: 502},
    LOGIN_EXPIRE: {code: -13, message: '登录信息过期', status: 403},

    INFO_FETCH_FAILED: {code: -20, message: '拉取基本信息失败', status: 502},
    INFO_NOT_FOUND: {code: -21, message: '漫画信息不存在', status: 301},

    COMIC_FETCH_FAILED: {code: -30, message: '拉取漫画下载失败', status: 502},
    COMIC_NOT_FOUND: {code: -31, message: '漫画信息不存在', status: 404},
    RETRY_CAPTCHA_ERROR: {code: -32, message: '验证码计算错误', status: 502},
    COMIC_PAY_ERROR: {code: -32, message: '收费本下载失败', status: 404},
};

module.exports = {
    PHASE,
    STEP,
    STATE,
    ERR
};
