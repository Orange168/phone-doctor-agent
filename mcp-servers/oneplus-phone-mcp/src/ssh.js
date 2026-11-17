// ssh.js — SSH 通道探测（op_ 局域网 / cf-op 外网）
import { execFile } from 'node:child_process';
import { config } from './config.js';

/**
 * 探测 SSH 通道连通性
 * @param {'lan'|'wan'} channel
 * @returns {Promise<{ok: boolean, alias: string, output: string, error?: string}>}
 */
export async function sshCheck(channel = 'lan') {
  const alias = config.sshAliases[channel];
  if (!alias) return { ok: false, alias: null, output: '', error: `unknown channel: ${channel}` };
  return new Promise((resolve) => {
    execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', alias, 'echo OK; whoami'],
      { timeout: 8000 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, alias, output: (stdout || '').toString(), error: (stderr || err.message).toString().trim() });
        } else {
          resolve({ ok: true, alias, output: (stdout || '').toString().trim() });
        }
      }
    );
  });
}
