const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const url = require('node:url');
const { createWorker } = require('tesseract.js');
const { Jimp } = require('jimp');
const OCRAD = require('ocrad.js');

/** tesseract.js 语言数据 CDN（与官方 worker 约定一致） */
const TESSERACT_LANG_PATH_CDN = 'https://unpkg.com/@tesseract.js-data/eng/4.0.0_best_int';

const SCALE = 2;

/**
 * 放大并二值化（浅色字 + 深底：灰度低于阈值置白，否则置黑）
 * @param {Buffer} imageBuffer
 * @param {number} threshold
 * @returns {Promise<import('jimp').Jimp>}
 */
async function preprocessCaptchaImage(imageBuffer, threshold) {
  const img = await Jimp.read(imageBuffer);
  await img.scale(SCALE);
  const pixels = img.bitmap.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    const val = gray < threshold ? 255 : 0;
    pixels[i] = val;
    pixels[i + 1] = val;
    pixels[i + 2] = val;
  }
  return img;
}

/** @param {import('jimp').Jimp} img */
function jimpToImageData(img) {
  return {
    width: img.bitmap.width,
    height: img.bitmap.height,
    data: new Uint8ClampedArray(img.bitmap.data),
  };
}

function isMathTextCorrect(mathText) {
  const flag1 =
    mathText.includes('+') ||
    mathText.includes('-') ||
    mathText.includes('*') ||
    mathText.includes('/');
  const flag2 =
    !mathText.startsWith('+') &&
    !mathText.startsWith('-') &&
    !mathText.startsWith('*') &&
    !mathText.startsWith('/');
  const flag3 =
    !mathText.endsWith('+') &&
    !mathText.endsWith('-') &&
    !mathText.endsWith('*') &&
    !mathText.endsWith('/');
  return flag1 && flag2 && flag3;
}

async function calcMathCaptcha(imageBuffer, options = {}) {
  let text = await getTextForMathCaptcha(imageBuffer, options);
  if (!text) {
    return null;
  }
  let mathText = (text || '').split('×').join('*').split('÷').join('/').split('_').join('');
  if (mathText.endsWith('-') || mathText.endsWith('=')) {
    mathText = mathText.substring(0, mathText.length - 1);
  }
  if (!mathText || !isMathTextCorrect(mathText)) {
    return { text };
  }
  let verification = 0;
  try {
    // 获取 左数字 符号 右数字
    const match = mathText.match(/(\d+)\s*([+\-*/])\s*(\d+)/);
    const left = Number(match[1].trim());
    const op   = match[2].trim();
    const right = Number(match[3].trim());
    if (left >= 30) {
      throw new Error(`左边数字过大：${left}`);
    }
    if (right >= 30) {
      throw new Error(`右边边数字过大：${right}`);
    }
    verification = eval(mathText);
    if ('-' === op) {
      if (verification < 0) {
        throw new Error(`结果不能为0：${left} - ${right}`);
      }
    }
  } catch {
    return { text, mathText };
  }
  return { text, mathText, verification };
}

async function getTextForMathCaptcha(imageBuffer, options = {}) {
  let text = await _getByTesseract(imageBuffer, options);
  // if (!_isValidMathExpr(text)) {
  //   console.log('Tesseract 识别失败或非法，尝试 OCRAD 兜底');
  //   text = await _getByOcrad(imageBuffer, options);
  // }
  return _normalizeMathText(text);
}

async function _getByTesseract(imageBuffer, options = {}) {
  try {
    const img = await preprocessCaptchaImage(imageBuffer, options.threshold || 150);
    const pngBuffer = await img.getBuffer('image/png');

    const langPath =
      options.langPath != null && String(options.langPath).trim() !== ''
        ? String(options.langPath).trim()
        : TESSERACT_LANG_PATH_CDN;
    const gzip =
      options.gzip !== undefined ? Boolean(options.gzip) : /^https?:\/\//i.test(langPath);
    const workerOpts = {
      tessedit_ocr_engine_mode: 1,
      tessedit_char_whitelist: '0123456789+-×÷=',
      langPath,
      gzip,
      worker: false
    };
    if ('production' === process.env.NODE_ENV && __TESSERACT_WASM_BASE64__ && __TESSERACT_NODE_WORKER__) {
      // 1、写出wasm
      const wasmPath = path.join(os.tmpdir(), 'tesseract-core-relaxedsimd.wasm');
      fs.writeFileSync(wasmPath, Buffer.from(__TESSERACT_WASM_BASE64__, 'base64'));
      // 2、写出worker
      const workerPath = path.join(os.tmpdir(), 'tesseract.worker-script.node.js');
      fs.writeFileSync(workerPath, __TESSERACT_NODE_WORKER__, 'utf8');
      workerOpts.workerPath = workerPath;
    }
    const worker = await createWorker('eng', 1, workerOpts);
    const {
      data: { text },
    } = await worker.recognize(pngBuffer);
    await worker.terminate();
    return text.trim();
  } catch (err) {
    console.error('Tesseract 识别异常:', err);
    return '';
  }
}

async function _getByOcrad(imageBuffer, options) {
  try {
    const img = await preprocessCaptchaImage(imageBuffer, options.threshold || 150);
    const text = OCRAD(jimpToImageData(img));
    return String(text || '').trim();
  } catch (err) {
    console.error('OCRAD 识别异常:', err);
    return '';
  }
}

function _isValidMathExpr(text) {
  if (!text) return false;
  return /[\+\-\×\÷\=]/.test(text);
}

function _normalizeMathText(text) {
  if (!text) return '';
  text = text.replace(/\s+/g, '');
  text = text.replace(/[^0-9\+\-\×\÷\=]/g, '');
  return text;
}

module.exports = {
  calcMathCaptcha,
};
