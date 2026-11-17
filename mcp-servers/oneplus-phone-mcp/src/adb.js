// adb.js — 统一 adb 调用通道
import { execFile } from 'node:child_process';
import { config } from './config.js';

/**
 * 运行 adb 命令（统一 -s <serial> 前缀）
 * @param {string[]} args adb 参数（不含 -s）
 * @param {{timeout?: number, asRoot?: boolean}} opts
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runAdb(args, opts = {}) {
  const { timeout = config.timeouts.adb, asRoot = false } = opts;
  const fullArgs = ['-s', config.serial, ...args];

  return new Promise((resolve) => {
    execFile(config.adbPath, fullArgs, { timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.killed) {
        resolve({ code: -1, stdout: '', stderr: `adb timeout after ${timeout}ms: ${fullArgs.join(' ')}` });
        return;
      }
      resolve({
        code: err ? (err.code ?? 1) : 0,
        stdout: (stdout || '').toString(),
        stderr: (stderr || '').toString(),
      });
    });
  });
}

/** 快捷：以 root 运行（KernelSU su） */
export async function runAdbRoot(args, opts = {}) {
  return runAdb(['shell', 'su', '-c', args.join(' ')], opts);
}

/** 检查设备是否在线 */
export async function isDeviceOnline() {
  const r = await runAdb(['get-state'], { timeout: 5000 });
  return r.code === 0 && r.stdout.trim() === 'device';
}

/** 设备序列号列表 */
export async function listDevices() {
  const r = await runAdb(['devices'], { timeout: 5000 });
  return r.stdout
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && p[1] === 'device')
    .map((p) => p[0]);
}

/** 获取设备属性 */
export async function getProp(name) {
  const r = await runAdb(['shell', 'getprop', name], { timeout: 5000 });
  return r.code === 0 ? r.stdout.trim() : null;
}
