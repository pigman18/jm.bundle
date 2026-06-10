const jmBundle = require('../jm.bundle/jm.bundle.js');

(async () => {
    await jmBundle.start({});
    let path = await jmBundle.state.crawler.fetchRemoteFile('https://cdn-msp2.18comic.vip/media/albums/1441017.jpg?u=1779420336');
    console.log(path);
})();
