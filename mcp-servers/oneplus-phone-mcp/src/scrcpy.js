// scrcpy.js — scrcpy 子进程管理（屏幕流）
import { spawn, execFile } from 'node:child_process';
import { config } from './config.js';

// 会话表: sessionId -> { pid, startedAt, opts }
const sessions = new Map();
let sessionCounter = 0;

function defaultScrcpyArgs(opts = {}) {
  const args = ['-s', config.serial];
  // 纯共享模式（默认 no-control，避免抢占输入；Agent 注入走 input-injection）
  if (!opts.control) args.push('--no-control');
  args.push('--max-fps', String(opts.maxFps ?? 10));
  args.push('--max-size', String(opts.maxSize ?? 800));
  // 无头模式：无显示器环境（WSL/服务器）录制屏幕流供 Agent 消费
  if (opts.headless !== false) {
    // --no-window：不创建窗口（真正无头），--record 录制仍工作
    args.push('--no-window');
    // WSL/服务器无音频设备 → 禁用音频，避免 Demuxer error 拖垮视频流
    if (opts.audio !== true) args.push('--no-audio');
  }
  if (opts.turnScreenOff) args.push('--turn-screen-off');
  if (opts.record) {
    args.push('--record', opts.record);
  }
  if (opts.title) args.push('--window-title', opts.title);
  return args;
}

/**
 * 启动 scrcpy 屏幕流
 * @param {{maxFps?: number, maxSize?: number, control?: boolean, title?: string, record?: string, headless?: boolean, audio?: boolean}} opts
 * @returns {Promise<{ok: boolean, sessionId?: string, pid?: number, args?: string[], stderr?: string, error?: string}>}
 */
export async function startScrcpy(opts = {}) {
  const args = defaultScrcpyArgs(opts);
  const child = spawn(config.scrcpyPath, args, {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ADB: config.adbPath, // scrcpy 用 ADB 环境变量定位 adb
    },
  });
  const sessionId = `share-${Date.now()}-${++sessionCounter}`;
  sessions.set(sessionId, {
    pid: child.pid,
    startedAt: Date.now(),
    opts,
    exitCode: null,
  });

  child.on('exit', (code, signal) => {
    const s = sessions.get(sessionId);
    if (s) {
      s.exitCode = code;
      s.signal = signal;
      s.endedAt = Date.now();
    }
  });
  child.on('error', (err) => {
    const s = sessions.get(sessionId);
    if (s) s.error = err.message;
  });

  // 收集 stderr 前几行（用于诊断 scrcpy 启动失败）
  let errBuf = '';
  child.stderr.on('data', (d) => {
    if (errBuf.length < 2048) errBuf += d.toString();
  });

  // 等待短暂启动确认（scrcpy 启动约需 1-3s，不阻塞太久）
  await new Promise((r) => setTimeout(r, 1200));
  if (child.exitCode !== null) {
    sessions.delete(sessionId);
    return {
      ok: false,
      error: `scrcpy exited early (code=${child.exitCode}): ${errBuf.trim() || 'no output'}`,
    };
  }
  return { ok: true, sessionId, pid: child.pid, args, stderr: errBuf.trim() };
}

/** 停止 scrcpy 会话 */
export async function stopScrcpy(sessionId = null) {
  const targets = sessionId ? [sessions.get(sessionId)].filter(Boolean) : [...sessions.values()];
  if (targets.length === 0) return { ok: true, stopped: 0, message: 'no active share sessions' };

  let stopped = 0;
  for (const s of targets) {
    try {
      // 尝试优雅终止，然后 SIGKILL
      process.kill(s.pid, 'SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (isAlive(s.pid)) process.kill(s.pid, 'SIGKILL');
      stopped++;
    } catch {
      // 进程可能已退出
      stopped++;
    }
  }
  if (sessionId) sessions.delete(sessionId);
  else sessions.clear();
  return { ok: true, stopped, message: `stopped ${stopped} share session(s)` };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 共享状态 */
export function scrcpyStatus() {
  const list = [...sessions.entries()].map(([id, s]) => ({
    sessionId: id,
    pid: s.pid,
    startedAt: s.startedAt,
    running: s.exitCode === null && isAlive(s.pid),
    exitCode: s.exitCode,
    opts: s.opts,
  }));
  return { active: list.filter((s) => s.running).length, sessions: list };
}

/** scrcpy 是否可用 */
export async function scrcpyAvailable() {
  try {
    const { version } = await new Promise((resolve, reject) => {
      execFile(config.scrcpyPath, ['--version'], { timeout: 5000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve({ version: stdout.split('\n')[0] });
      });
    });
    return { ok: true, version };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
