// frida.js — frida 逆向工具链（server 管理 / 注入脚本 / 进程枚举）
import { runAdb, runAdbRoot } from './adb.js';
import { execFile } from 'node:child_process';
import { config } from './config.js';

const FRIDA_BIN = '/data/adb/frida-server';

// ============ frida-server 管理 ============

/** frida-server 状态 */
export async function fridaStatus() {
  const r = await runAdb(['shell', 'su', '-c', 'ps -A | grep frida'], { timeout: 5000 });
  const running = r.code === 0 && r.stdout.includes('frida-server');
  let version = null;
  const verR = await runAdb(['shell', 'su', '-c', `${FRIDA_BIN} --version`], { timeout: 8000 });
  if (verR.code === 0) version = verR.stdout.trim();
  return { ok: true, running, version, pid: running ? extractPid(r.stdout) : null };
}

function extractPid(psOut) {
  const m = /\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+frida-server/.exec(psOut);
  return m ? parseInt(m[1], 10) : null;
}

/** 启动 frida-server */
export async function fridaStart() {
  const r = await runAdb(['shell', 'su', '-c', `nohup ${FRIDA_BIN} -D >/dev/null 2>&1 &`], { timeout: 8000 });
  await new Promise((r2) => setTimeout(r2, 1500));
  const status = await fridaStatus();
  return { ok: status.running, ...status, startError: r.stderr.trim() };
}

/** 停止 frida-server */
export async function fridaStop() {
  const r = await runAdb(['shell', 'su', '-c', `pkill -f frida-server`], { timeout: 8000 });
  return { ok: true, output: r.stdout.trim() || r.stderr.trim() || 'killed' };
}

// ============ frida 进程枚举 ============

/** 列出设备进程（frida-ps 等价，走 frida 通道） */
export async function fridaPs() {
  // 用本机 frida CLI（若可用）
  const local = await tryFridaCli(['-U', '-p']);
  if (local.ok) return local;
  // 回退：root ps
  const r = await runAdb(['shell', 'su', '-c', 'ps -A'], { timeout: 8000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };
  const procs = r.stdout.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 9);
  return {
    ok: true,
    method: 'ps-fallback',
    processes: procs.map((p) => ({ pid: parseInt(p[1], 10), name: p[8] })).slice(0, 200),
  };
}

/** 尝试本机 frida CLI */
function tryFridaCli(args) {
  return new Promise((resolve) => {
    execFile('frida-ps', args, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: err.message });
      const lines = stdout.split('\n').filter(Boolean).slice(1);
      const processes = lines.map((l) => {
        const m = /^\s*(\d+)\s+(.+)$/.exec(l);
        return m ? { pid: parseInt(m[1], 10), name: m[2].trim() } : null;
      }).filter(Boolean);
      resolve({ ok: true, method: 'frida-cli', processes });
    });
  });
}

// ============ frida 注入 ============

/**
 * 向进程注入 frida 脚本（通过本机 frida CLI）
 * @param {string} target 进程名/包名/pid
 * @param {string} script frida JS 脚本内容或文件路径
 * @param {{timeout?: number}} opts
 */
export async function fridaInject(target, script, opts = {}) {
  const timeout = opts.timeout || 15000;
  // 脚本写临时文件
  const fs = await import('node:fs');
  const path = await import('node:path');
  const tmpScript = path.join('/tmp', `frida-${Date.now()}.js`);
  fs.writeFileSync(tmpScript, script);

  return new Promise((resolve) => {
    execFile('frida', ['-U', '-n', target, '-l', tmpScript, '--runtime=v8', '-q'], { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpScript); } catch {}
      if (err && !stdout) {
        return resolve({ ok: false, error: stderr.trim() || err.message });
      }
      resolve({ ok: true, output: (stdout || stderr || '').toString().slice(-3000) });
    });
  });
}

/**
 * 注入脚本（设备端 frida-server + 本机 frida CLI spawn 模式）
 * @param {string} pkg 包名（spawn 启动）
 * @param {string} script frida JS 内容
 */
export async function fridaSpawn(pkg, script, opts = {}) {
  const timeout = opts.timeout || 20000;
  const fs = await import('node:fs');
  const path = await import('node:path');
  const tmpScript = path.join('/tmp', `frida-spawn-${Date.now()}.js`);
  fs.writeFileSync(tmpScript, script);

  return new Promise((resolve) => {
    execFile('frida', ['-U', '-f', pkg, '-l', tmpScript, '--runtime=v8', '-q'], { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpScript); } catch {}
      if (err && !stdout) {
        return resolve({ ok: false, error: stderr.trim() || err.message });
      }
      resolve({ ok: true, output: (stdout || stderr || '').toString().slice(-3000) });
    });
  });
}

/** 设备端 frida-server 直接执行（无需本机 frida CLI，用 adb 转发端口） */
export async function fridaRemote(script, opts = {}) {
  // 确保 frida-server 运行
  const status = await fridaStatus();
  if (!status.running) {
    await fridaStart();
  }
  // 需要 adb forward 27042
  await runAdb(['forward', 'tcp:27042', 'tcp:27042'], { timeout: 5000 });
  return { ok: true, note: 'frida-server running on tcp:27042 (local) via adb forward', status };
}
