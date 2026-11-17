// config.js — 统一设备通道配置
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 默认值基于 docs/device/oneplus-pgp110-environment.md
export const config = {
  serial: process.env.ONEPLUS_SERIAL || '3902f377',
  adbPath: process.env.ADB_PATH || '/home/master/sourceCode/rk_356x_a12/code/prebuilts/runtime/adb',
  scrcpyPath: process.env.SCRCPY_PATH || '/usr/local/bin/scrcpy',
  outputDir: process.env.ONEPLUS_OUTPUT || path.join(__dirname, 'output'),
  screenshotsDir: process.env.ONEPLUS_OUTPUT
    ? path.join(process.env.ONEPLUS_OUTPUT, 'screenshots')
    : path.join(__dirname, 'output', 'screenshots'),
  sshAliases: { lan: 'op_', wan: 'cf-op' },
  timeouts: {
    adb: 15000,
    dump: 20000,
    screenshot: 15000,
  },
};

export function ensureDirs() {
  fs.mkdirSync(config.screenshotsDir, { recursive: true });
  fs.mkdirSync(path.join(config.outputDir, 'layouts'), { recursive: true });
  return config.outputDir;
}
