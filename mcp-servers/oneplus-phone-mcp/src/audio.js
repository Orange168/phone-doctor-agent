// audio.js — 音频控制（录音/播放/音量/TTS/路由）
import fs from 'node:fs';
import path from 'node:path';
import { runAdb, runAdbRoot } from './adb.js';
import { config } from './config.js';

const AUDIO_DIR = path.join(config.outputDir, 'audio');

function ensureDir() {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  return AUDIO_DIR;
}

/**
 * 录音（设备端麦克风）
 * @param {{duration?: number, format?: string}} opts
 */
export async function audioRecord(opts = {}) {
  const { duration = 5, format = 'wav' } = opts;
  ensureDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const remoteFile = `/sdcard/record-${timestamp}.${format}`;
  const localFile = path.join(AUDIO_DIR, `${timestamp}.${format}`);

  // screenrecord 可录音频（mic），或用 Termux termux-microphone-record
  // 方案1：screenrecord --audio-source=mic
  const r = await runAdb([
    'shell', 'screenrecord', '--time-limit', String(duration),
    '--audio-source', 'mic', '--audio-encoder', 'aac', remoteFile,
  ], { timeout: duration * 1000 + 10000 });
  if (r.code !== 0) {
    // 回退方案2：Termux termux-microphone-record
    const tr = await runAdb([
      'shell', 'su', '-c',
      `/data/data/com.termux/files/usr/bin/termux-microphone-record -d ${duration} -f ${remoteFile.replace(/\.wav$/, '.m4a')}`,
    ], { timeout: duration * 1000 + 10000 });
    if (tr.code !== 0) return { ok: false, error: 'both recording methods failed: ' + r.stderr.trim() + ' / ' + tr.stderr.trim() };
  }
  // pull
  const pullR = await runAdb(['pull', remoteFile, localFile], { timeout: 10000 });
  return {
    ok: pullR.code === 0,
    file: localFile,
    duration,
    format,
    size: fs.existsSync(localFile) ? fs.statSync(localFile).size : 0,
  };
}

/**
 * 播放音频（设备端）
 * @param {{file?: string, url?: string}} opts
 */
export async function audioPlay(opts = {}) {
  const { file = '', url = '' } = opts;
  if (!file && !url) return { ok: false, error: 'specify file or url' };

  // 方案1：Termux media player
  const target = file || url;
  const r = await runAdb(['shell', 'su', '-c', `/data/data/com.termux/files/usr/bin/termux-media-player play ${target}`], { timeout: 8000 });
  if (r.code === 0) return { ok: true, method: 'termux-media-player', target };
  // 方案2：am start intent
  const r2 = await runAdb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `file://${target}`, '-t', 'audio/*'], { timeout: 8000 });
  return { ok: r2.code === 0, method: 'am-start', target, fallbackError: r.stderr.trim() };
}

/** 音量控制 */
export async function audioVolume(opts = {}) {
  const { stream = 'music', value = null } = opts;
  const streams = { music: 3, ring: 2, alarm: 4, notification: 5, call: 0 };
  const streamId = streams[stream];
  if (streamId === undefined) return { ok: false, error: `unknown stream: ${stream}` };

  if (value !== null) {
    const r = await runAdb(['shell', 'media', 'volume', '--stream', String(streamId), '--set', String(value)], { timeout: 8000 });
    return { ok: r.code === 0, stream, value, output: r.stdout.trim() || r.stderr.trim() };
  }
  // 读当前音量
  const r = await runAdb(['shell', 'media', 'volume', '--stream', String(streamId), '--get'], { timeout: 8000 });
  return { ok: r.code === 0, stream, current: r.stdout.trim() || r.stderr.trim() };
}

/** TTS 朗读 */
export async function audioTts(opts = {}) {
  const { text = '', speed = 1.0 } = opts;
  if (!text) return { ok: false, error: 'text required' };
  // 方案1：Termux espeak
  const r = await runAdb(['shell', 'su', '-c', `/data/data/com.termux/files/usr/bin/espeak -s ${Math.round(175 * speed)} "${text}" 2>&1`], { timeout: 15000 });
  if (r.code === 0) return { ok: true, method: 'espeak', text: text.slice(0, 50) };
  // 方案2：Android TTS（需安装 apk）
  return { ok: false, error: 'espeak not available: ' + r.stderr.trim() };
}

/** 音频路由（扬声器/耳机/蓝牙） */
export async function audioRoute(opts = {}) {
  const { device = 'speaker' } = opts;
  const devices = { speaker: 'SPEAKER', earpiece: 'EARPIECE', bluetooth: 'BLUETOOTH_A2DP' };
  const target = devices[device];
  if (!target) return { ok: false, error: `unknown device: ${device}` };

  // 通过 AudioManager 切路由（root 下用 media 命令）
  const r = await runAdb(['shell', 'su', '-c', `media audio routing set ${target}`], { timeout: 8000 });
  return { ok: r.code === 0, device, target, output: r.stdout.trim() || r.stderr.trim() };
}

/** 验证音频文件可解析 */
export async function audioVerify(opts = {}) {
  const { file = '' } = opts;
  if (file) {
    // 本机 ffprobe 校验
    const { execFile } = await import('node:child_process');
    return new Promise((resolve) => {
      execFile('ffprobe', ['-v', 'quiet', '-show_format', file], { timeout: 8000 }, (err, stdout) => {
        if (err) return resolve({ ok: false, error: 'not a valid audio file: ' + err.message });
        const dur = /duration=([\d.]+)/.exec(stdout)?.[1];
        const fmt = /format_name=([^\n]+)/.exec(stdout)?.[1];
        resolve({ ok: true, file, format: fmt, duration: dur ? parseFloat(dur).toFixed(2) : null });
      });
    });
  }
  // 无文件：检查录音能力
  const r = await runAdb(['shell', 'ls', '/system/bin/screenrecord'], { timeout: 5000 });
  return { ok: r.code === 0, note: 'screenrecord (audio) available', hasScreenrecord: r.code === 0 };
}
