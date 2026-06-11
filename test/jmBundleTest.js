const jmBundle = require('../jm.bundle/jm.bundle.js');

async function getMeta(number) {
    try {
        return await jmBundle.state.crawler.comic.getMeta(number)
    } catch (e) {
        console.log(e.message);
    }
}

(async () => {
    await jmBundle.start({});
    // let path = await jmBundle.state.crawler.fetchRemoteFile('https://cdn-msp2.18comic.vip/media/albums/1441017.jpg?u=1779420336');
    // console.log(path);
    // let meta = await getMeta(1044570);
    // console.log(meta);
    await jmBundle.state.crawler.comic.downloadArchive(275942);
})();
