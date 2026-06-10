const fs = require('node:fs');
const {listFiles, getBaseName} = require('../util/file');

(async () => {
    let files = listFiles('C:\\data\\jm\\html');
    let existsNumbers = files.map((file) => Number.parseInt(getBaseName(file)));
    let numbers = JSON.parse(fs.readFileSync('./fetchInfo.json', 'utf-8'));
    existsNumbers = [
        ...existsNumbers,
        ...numbers
    ];
    existsNumbers = [...new Set(existsNumbers)];
    fs.writeFileSync('./fetchInfo.json', JSON.stringify(existsNumbers));
})();
