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
    // 1、获取每周必看期数
    // let weekInfo = await jmBundle.state.crawler.rank.monthInfo();
    // // 2、获取每周必看
    // let resp1 = await jmBundle.state.crawler.rank.monthly(weekInfo.categories[0].id, null);
    // let resp2 = await jmBundle.state.crawler.rank.monthly(weekInfo.categories[0].id, weekInfo.type[0].id);
    // let resp3 = await jmBundle.state.crawler.rank.monthly(weekInfo.categories[0].id, weekInfo.type[1].id);
    // let resp4 = await jmBundle.state.crawler.rank.monthly(weekInfo.categories[0].id, weekInfo.type[2].id);
    // console.log(resp1);
    // let serialization = await jmBundle.state.crawler.rank.serialization(0);
    // console.log(serialization);
    // let categories = await jmBundle.state.crawler.rank.categories();
    // 同人、
    await jmBundle.state.crawler.rank.categoriesFilter(1, 'a', 'doujin', 'mv');
    console.log(categories);
})();
