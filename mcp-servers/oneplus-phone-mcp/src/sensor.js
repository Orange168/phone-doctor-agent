// sensor.js — 传感器模拟（状态/读取/伪造/采集/回放）
import fs from 'node:fs';
import path from 'node:path';
import { runAdb, runAdbRoot } from './adb.js';
import { config } from './config.js';

const SENSOR_TYPES = ['accelerometer', 'gyroscope', 'light', 'proximity', 'magnetic', 'orientation'];
const SENSOR_TYPES_MAP = {
  accelerometer: 'android.sensor.accelerometer',
  gyroscope: 'android.sensor.gyroscope',
  light: 'android.sensor.light',
  proximity: 'android.sensor.proximity',
  magnetic: 'android.sensor.magnetic_field',
  orientation: 'android.sensor.orientation',
};

/** 列出设备传感器 */
export async function sensorStatus() {
  const r = await runAdb(['shell', 'dumpsys', 'sensorservice'], { timeout: 8000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };
  // 解析传感器列表（dumpsys sensorservice 输出的 "name" / type 段）
  const sensors = [];
  const lines = r.stdout.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('name=') && l.includes('vendor=')) {
      const name = /name=([^,]+)/.exec(l)?.[1]?.trim();
      const vendor = /vendor=([^,]+)/.exec(l)?.[1]?.trim();
      const type = /type=(\d+)/.exec(l)?.[1];
      const version = /version=(\d+)/.exec(l)?.[1];
      sensors.push({ name, vendor, type, version });
    }
  }
  return { ok: true, count: sensors.length, sensors: sensors.slice(0, 50) };
}

/** 读取当前传感器值（dumpsys sensorservice 最近值） */
export async function sensorRead(type = 'all') {
  const r = await runAdb(['shell', 'dumpsys', 'sensorservice'], { timeout: 8000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };
  // 解析 "last known" / 最近事件
  const readings = {};
  const lines = r.stdout.split('\n');
  for (const l of lines) {
    for (const st of SENSOR_TYPES) {
      const re = new RegExp(`${SENSOR_TYPES_MAP[st]}[^\\n]*last=[^\\n]*`);
      const m = re.exec(l);
      if (m) readings[st] = m[0].slice(0, 200);
    }
  }
  // 若全部为空，尝试解析数据行
  const filtered = type !== 'all' ? { [type]: readings[type] || 'no data' } : readings;
  return { ok: true, readings: filtered };
}

/**
 * 伪造传感器值（root 写 sysfs 或通过注入服务）
 * Android 15 传感器伪造通常需要：
 * 1. 内核级（改驱动）— 最彻底但需刷机
 * 2. 用户态注入（root 写 /dev/sensor 或 hook sensor HAL）
 * 3. 应用级（Xposed hook SensorManager）
 *
 * 当前实现：提供参数校验 + 生成数据流 + 保存可回放 JSON；
 * 实际注入通道（Xposed hook 或内核）在 REQ-SS-2 标注待选
 */
export async function sensorSpoof(type, opts = {}) {
  if (!SENSOR_TYPES.includes(type)) {
    return { ok: false, error: `unknown sensor: ${type} (${SENSOR_TYPES.join('/')})` };
  }
  const { x = 0, y = 0, z = 0, jitter = 0, stream = '', duration = 10, intervalMs = 100 } = opts;

  // 生成数据流（静态值 + 抖动 → 序列）
  let values;
  if (stream) {
    values = stream.split(';').map((s) => s.split(',').map(Number));
  } else {
    values = [];
    const samples = Math.floor(duration * 1000 / intervalMs);
    for (let i = 0; i < samples; i++) {
      const jx = jitter > 0 ? (Math.random() - 0.5) * 2 * jitter : 0;
      const jy = jitter > 0 ? (Math.random() - 0.5) * 2 * jitter : 0;
      const jz = jitter > 0 ? (Math.random() - 0.5) * 2 * jitter : 0;
      values.push([x + jx, y + jy, z + jz]);
    }
  }

  // 保存到输出目录（可回放）
  const dir = path.join(config.outputDir, 'sensors');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${type}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({
    type, values, intervalMs, generatedAt: new Date().toISOString(),
  }, null, 2));

  return {
    ok: true,
    type,
    samples: values.length,
    file,
    method: 'data-generated',
    note: 'data stream generated; injection via Xposed hook (SensorManager) pending',
  };
}

/** 采集真人传感器数据 */
export async function sensorRecord(type, opts = {}) {
  const { duration = 5, intervalMs = 100 } = opts;
  if (!SENSOR_TYPES.includes(type)) {
    return { ok: false, error: `unknown sensor: ${type}` };
  }
  // 用 dumpsys sensorservice 轮询采集（root 下可读）
  const samples = [];
  const start = Date.now();
  while (Date.now() - start < duration * 1000) {
    const r = await sensorRead(type);
    if (r.ok && r.readings[type]) samples.push({ t: Date.now() - start, value: r.readings[type] });
    await new Promise((r2) => setTimeout(r2, intervalMs));
  }
  const dir = path.join(config.outputDir, 'sensors');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `record-${type}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ type, samples, duration, intervalMs }, null, 2));
  return { ok: true, type, samples: samples.length, file };
}

/** 回放采集的数据流（提示注入通道） */
export async function sensorReplay(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ok: true,
      type: data.type,
      samples: data.values?.length || data.samples?.length || 0,
      intervalMs: data.intervalMs,
      file,
      note: 'replay data loaded; injection channel (Xposed/kernel) pending',
    };
  } catch (e) {
    return { ok: false, error: `cannot read replay file: ${e.message}` };
  }
}

/** 验证传感器伪造是否生效 */
export async function sensorVerify(type) {
  const r = await sensorRead(type);
  return {
    ok: r.ok,
    ...r,
    note: 'compare with expected spoof values; if identical, spoof active',
  };
}
