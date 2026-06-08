const m = require('./dist/module.bundle.js');

(async () => {
    console.log(m.config);
    await m.init();
    console.log(m.config);
})();


