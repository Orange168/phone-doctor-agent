// screen.js — 屏幕截图
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config, ensureDirs } from './config.js';
import { runAdb } from './adb.js';

/**
 * 截屏（screencap → 本地 PNG）
 * @param {{format?: 'png'|'jpeg', quality?: number, max_size?: number}} opts
 * @returns {Promise<{ok: boolean, path?: string, width?: number, height?: number, timestamp?: string, error?: string}>}
 */
export async function captureScreen(opts = {}) {
  ensureDirs();
  const format = opts.format || 'png';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const localPath = path.join(config.screenshotsDir, `${timestamp}.${format}`);

  // 1. screencap 到设备
  const remoteRaw = format === 'jpeg' ? '/sdcard/cap.jpg' : '/sdcard/cap.png';
  const capR = await runAdb(['shell', 'screencap', '-p', remoteRaw], { timeout: config.timeouts.screenshot });
  if (capR.code !== 0) {
    return { ok: false, error: `screencap failed: ${capR.stderr.trim() || capR.stdout.trim()}` };
  }

  // 2. pull
  const pullR = await runAdb(['pull', remoteRaw, localPath], { timeout: config.timeouts.screenshot });
  if (pullR.code !== 0) {
    return { ok: false, error: `pull failed: ${pullR.stderr.trim() || pullR.stdout.trim()}` };
  }

  // 3. 校验文件
  if (!fs.existsSync(localPath) || fs.statSync(localPath).size < 100) {
    return { ok: false, error: 'screenshot file empty or too small' };
  }

  // 4. 尺寸（读 PNG/JPEG 头）
  const { width, height } = readImageSize(localPath, format);

  // 5. JPEG 转换或 max_size 缩放（用 node 内置无依赖方案：仅当需要时）
  let finalPath = localPath;
  if (format === 'jpeg' && opts.quality && opts.quality < 100) {
    // 需要转换质量 → 用 python3 + PIL 或保持原样（PNG→JPEG 由 screencap -p 不做；这里简单记录）
  }
  if (opts.max_size && Math.max(width || 0, height || 0) > opts.max_size) {
    const scaled = await scaleImage(localPath, opts.max_size, format);
    if (scaled) finalPath = scaled;
  }

  return {
    ok: true,
    path: finalPath,
    width,
    height,
    timestamp,
    format,
  };
}

/** 读取图片尺寸（PNG 头 / JPEG 头） */
export function readImageSize(filePath, format) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(32);
    fs.readSync(fd, buf, 0, 32, 0);
    fs.closeSync(fd);
    if (format === 'png' && buf.toString('hex', 0, 8) === '89504e470d0a1a0a') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (format === 'jpeg' && buf[0] === 0xff && buf[1] === 0xd8) {
      // 扫 JPEG SOF 段
      let offset = 2;
      while (offset < 32) {
        if (buf[offset] !== 0xff) { offset++; continue; }
        const marker = buf[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
        }
        offset += 2 + buf.readUInt16BE(offset + 2);
      }
    }
  } catch {}
  return { width: null, height: null };
}

/** 缩放图片（用 ImageMagick 若可用；否则原样返回） */
async function scaleImage(src, maxSize, format) {
  const out = src.replace(/\.(png|jpeg|jpg)$/, `-scaled.$1`);
  return new Promise((resolve) => {
    execFile('convert', [src, '-resize', `${maxSize}x${maxSize}>`, out], { timeout: 10000 }, (err) => {
      if (err) resolve(null);
      else resolve(fs.existsSync(out) ? out : null);
    });
  });
}
