'use strict';
/**
 * all打包配置，打包后js可直接使用，但是有平台限制
 */
const fs = require('node:fs');
const path = require('node:path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

const bundleRoot = path.join(__dirname, '..');
const distDir = path.join(bundleRoot, 'dist');
const { execSync } = require('child_process');

module.exports = {
    target: 'node',
    mode: 'production',
    context: bundleRoot,
    entry: path.join(bundleRoot, 'jm.bundle.js'),
    output: {
        path: distDir,
        filename: 'jm.bundle.all.js',
        libraryTarget: 'commonjs',
    },
    optimization: {
        usedExports: false,
        minimize: true,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    compress: {collapse_vars: true, reduce_vars: true},
                    output: {comments: false},
                },
            }),
        ],
        splitChunks: false,
        runtimeChunk: false,
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                parser: {dynamicImportMode: 'eager'},
            },
            {test: /\.node$/, loader: 'node-loader'},
            {test: /\.md$/, type: 'asset/source'},
        ],
    },
    plugins: [
        new webpack.NormalModuleReplacementPlugin(/[/\\]web-embedded\.json$/, (resource) => {
            const distEmb = path.join(distDir, 'web-embedded.json');
            const stub = path.join(__dirname, 'empty-web-embedded.json');
            resource.request = fs.existsSync(distEmb) ? distEmb : stub;
        }),
        // tesseract.js/dist/worker.min.js 改成base64打包进代码
        new webpack.DefinePlugin({
            // 1、打包 tesseract.js 的 worker-script
            __TESSERACT_NODE_WORKER__: (() => {
                execSync(`npx webpack --config build/webpack.config.tesseract.js`, {
                    stdio: 'inherit'
                });
                let workerPath = path.resolve(__dirname, '../dist/worker-script.node.js');
                return JSON.stringify(fs.readFileSync(workerPath, 'utf8'))
            })(),
            // 2、打包 wasm
            __TESSERACT_WASM_BASE64__: (() => {
                let wasmPath = require.resolve('tesseract.js-core/tesseract-core-relaxedsimd.wasm');
                return JSON.stringify(fs.readFileSync(wasmPath).toString('base64'))
            })(),
        }),
    ],
    externals: {
        'encoding': 'commonjs encoding'
    },
};
