#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEmbedWeb, buildWebpack } from "../../build/build-util.mjs";

const _dirname = path.dirname(fileURLToPath(import.meta.url));
const bundleRoot = path.join(_dirname, '..');
const repoRoot = path.join(bundleRoot, '..');

// 1、打包web工程
const webProjectRoot = path.join(repoRoot, 'jm.bundle.front');
buildEmbedWeb(webProjectRoot, bundleRoot);

// 2、打包webpack
buildWebpack(path.join(_dirname, 'webpack.config.js'), bundleRoot);
buildWebpack(path.join(_dirname, 'webpack.config.all.js'), bundleRoot);

console.log('[jm.bundle build] ok');
