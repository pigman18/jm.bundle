const jmBundle = require('../jm.bundle/jm.bundle.js');

(async () => {
    await jmBundle.activate({});
    console.log(jmBundle.state.config);
})();