const jmBundle = require('../jm.bundle/jm.bundle.js');

async function getMeta(number) {
    try {
        return await jmBundle.state.crawler.album.getMeta(number)
    } catch (e) {
        console.log(e.message);
    }
}

(async () => {
    await jmBundle.start({});
    let path = await jmBundle.state.crawler.fetchRemoteFile('https://cdn-msp2.18comic.vip/media/albums/1441017.jpg?u=1779420336');
    console.log(path);
    let meta = await getMeta(1441017);
    let meta1 = await getMeta(1488081);
    let meta2 = await getMeta(100);
    let meta3 = await getMeta(1440690);
    let meta4 = await getMeta(1440138);
    let meta5 = await getMeta(1440164);
    console.log(meta);
})();
