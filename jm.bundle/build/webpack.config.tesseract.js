'use strict';
/**
 * 打包 tesseract 文件
 */
const path = require('node:path');
const bundleRoot = path.join(__dirname, '..');
const distDir = path.join(bundleRoot, 'dist');

// require('tesseract.js/src/worker-script/node/index.js');
module.exports = {
    target: 'node',
    mode: 'production',
    entry: require.resolve('tesseract.js/src/worker-script/node/index.js'),
    output: {
        path: distDir,
        filename: 'worker-script.node.js',
        libraryTarget: 'commonjs2'
    }
};
