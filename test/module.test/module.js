function createConfig() {
    return {
        text: '我是配置'
    }
}

function createMessage() {
    return {
        text: '我是消息'
    }
}

function createStore() {
    return {
        text: '我是存储'
    }
}


function createCrawler() {
    return {
        text: '我是爬虫'
    }
}


function createServer() {
    return {
        text: '我是服务'
    }
}

function createBundle1() {
    let state = {
        jmConfig: null,
        jmMessage: null,
        jmStore: null,
        jmCrawler: null,
        jmServer: null
    };

    async function init() {
        state.jmConfig = createConfig();
        state.jmMessage = createMessage();
        state.jmStore = createStore();
        state.jmCrawler = createCrawler();
        state.jmServer = createServer();
    }

    return {
        init,
        get config() { return state.jmConfig; },
        get message() { return state.jmMessage; },
        get store() { return state.jmStore; },
        get crawler() { return state.jmCrawler; },
        get server() { return state.jmServer; },
    }
}

let bundle = createBundle1();

module.exports = bundle;
