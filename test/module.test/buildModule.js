const path = require('path');
const webpack = require('webpack');
const fs = require('node:fs');
const TerserPlugin = require('terser-webpack-plugin');

const bundleRoot = path.join(__dirname, '..');
const distDir = path.join(bundleRoot, 'dist');
const { execSync } = require('child_process');

webpack({
    entry: './module.js',
    output: {
        filename: 'module.bundle.js',
        libraryTarget: 'commonjs2'
    },
    target: 'node',
    mode: 'production',
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
        ],
    },
    plugins: [
        new webpack.NormalModuleReplacementPlugin(/[/\\]web-embedded\.json$/, (resource) => {
            const distEmb = path.join(distDir, 'web-embedded.json');
            const stub = path.join(__dirname, 'empty-web-embedded.json');
            resource.request = fs.existsSync(distEmb) ? distEmb : stub;
        }),
    ],
    externals: {
        'encoding': 'commonjs encoding'
    },

}).run();
