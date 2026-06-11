const jmBundle = require('../jm.bundle/jm.bundle.js');
const {SearchSort} = require('../jm.bundle/protocol');
const {toQueryString, fetchAllPageData} = require('../util/http');

async function getMeta(number) {
    try {
        return await jmBundle.state.crawler.comic.getMeta(number)
    } catch (e) {
        console.log(e.message);
    }
}

(async () => {
    /**
     ApiPath::Login | ApiPath::GetUserProfile => "/login",
     ApiPath::Search => "/search",
     ApiPath::GetComic => "/album",
     ApiPath::GetChapter => "/chapter",
     ApiPath::GetScrambleId => "/chapter_view_template",
     ApiPath::GetFavoriteFolder => "/favorite",
     ApiPath::GetWeeklyInfo => "/week",
     ApiPath::GetWeekly => "/week/filter",
     */
    await jmBundle.start({});
    // let path = await jmBundle.state.crawler.fetchRemoteFile('https://cdn-msp2.18comic.vip/media/albums/1441017.jpg?u=1779420336');
    // console.log(path);
    // let meta = await getMeta(1044570);
    // console.log(meta);
    // await jmBundle.state.crawler.comic.downloadArchive(275942);
    // await jmBundle.state.crawler.search.byKeyword('明日方舟', SearchSort.Latest)
    let list = await fetchAllPageData((pageNum) => {
        return jmBundle.state.crawler.search.byKeyword("明日方舟", pageNum);
    });
    console.log(list);
    // let resp = await jmBundle.state.crawler.reqApi(`/week`);
    // console.log(resp);
    let params = {
        "id": 243,
        "type": "hanman",
    };
    let resp = await jmBundle.state.crawler.reqApi(`/week/filter?${toQueryString(params)}`);
    console.log(resp);
})();
