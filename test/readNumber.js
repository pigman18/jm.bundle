const fs = require('node:fs');

const {listFiles} = require('../util/file');
const {getByTesseract} = require('../util/captcha');

(async () => {
    let files = listFiles('E:\\Screenshots');
    for(let file of files) {
        let retryCount = 0;
        let thresholds = [60, 80, 100, 120, 140, 160, 180, 200, 220];
        const buffer = fs.readFileSync(file);
        let threshold = thresholds[retryCount || 0];
        let text = await getByTesseract(buffer, {
            threshold: threshold
        });
        console.log(text);
    }
})();