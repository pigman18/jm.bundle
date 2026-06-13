const b = require('./dist/jm.bundle.all.js');
const tmp = 'C:\\Users\\ADMINI~1\\AppData\\Local\\Temp\\opencode\\test-page';
if (!require('fs').existsSync(tmp)) require('fs').mkdirSync(tmp, {recursive:true});
const manifest = {workspace: tmp, id: 'jm.bundle'};
const config = require('./core/config.js').createConfig(manifest, {});
const msg = require('./core/message.js').createMessage(manifest, {}, {});
const store = require('./core/store.js').createStore(manifest, {}, msg, config, null);

(async () => {
  try {
    const conn = await store.connect();
    await conn.exec('CREATE TABLE IF NOT EXISTS comic_meta (id INTEGER PRIMARY KEY, name TEXT, author JSON, tags JSON, series JSON, series_id TEXT, create_time INTEGER, update_time INTEGER)');

    // Simulate the exact page() call from server.js with empty params (no filters)
    const params = {};
    const pageNum = 1, pageSize = 10;
    const where = "WHERE 1=1 AND (series_id IS NULL OR series_id = '' OR series_id = '0' OR series_id = id)";
    const orderBy = 'update_time', orderBySeq = 'DESC';

    console.log('Calling page with empty params...');
    let countRow = conn.prepare('SELECT COUNT(*) as c FROM comic_meta ' + where).get(params);
    console.log('Count:', countRow?.c);

    let rows = conn.prepare('SELECT * FROM comic_meta ' + where + ' ORDER BY ' + orderBy + ' ' + orderBySeq + ' LIMIT @lim OFFSET @off').all({...params, lim: pageSize, off: 0});
    console.log('Rows:', rows.length);

    // Now test with name filter
    const params2 = { n: '%test%' };
    const where2 = 'WHERE 1=1 AND name LIKE @n';
    console.log('Calling page with name filter...');
    countRow = conn.prepare('SELECT COUNT(*) as c FROM comic_meta ' + where2).get(params2);
    console.log('Count:', countRow?.c);

    rows = conn.prepare('SELECT * FROM comic_meta ' + where2 + ' ORDER BY update_time DESC LIMIT @lim OFFSET @off').all({...params2, lim: pageSize, off: 0});
    console.log('Rows:', rows.length);

    console.log('All OK');
    await conn.close();
  } catch(e) {
    console.log('Error:', e.message);
    console.log(e.stack);
  }
  process.exit(0);
})();
