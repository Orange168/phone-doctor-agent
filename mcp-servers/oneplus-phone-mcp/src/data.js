// data.js — 数据飞轮（操作记录/数据集/导出/回放/统计）
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const FLYWHEEL_DIR = path.join(config.outputDir, 'flywheel');

function ensureDir() {
  fs.mkdirSync(FLYWHEEL_DIR, { recursive: true });
  return FLYWHEEL_DIR;
}

function listRecords() {
  ensureDir();
  return fs.readdirSync(FLYWHEEL_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(FLYWHEEL_DIR, f), 'utf8'));
        return { file: f, ...d };
      } catch {
        return { file: f, error: 'unparseable' };
      }
    });
}

/**
 * 记录一次操作（统一格式）
 * @param {{app?: string, action?: string, result?: string, error?: string, screenshot?: string, ui_tree?: string, screen_label?: string}} data
 */
export async function dataRecord(data) {
  ensureDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const record = {
    timestamp: new Date().toISOString(),
    app: data.app || '',
    action: data.action || '',
    result: data.result || '',
    error: data.error || '',
    screenshot: data.screenshot || '',
    ui_tree: data.ui_tree || '',
    screen_label: data.screen_label || '',
  };
  const file = path.join(FLYWHEEL_DIR, `${timestamp}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return { ok: true, file, record };
}

/** 数据集概览 */
export async function dataDataset() {
  const records = listRecords();
  const byApp = {};
  const byResult = {};
  for (const r of records) {
    if (r.app) byApp[r.app] = (byApp[r.app] || 0) + 1;
    const res = r.result || 'unknown';
    byResult[res] = (byResult[res] || 0) + 1;
  }
  return {
    ok: true,
    count: records.length,
    dir: FLYWHEEL_DIR,
    byApp,
    byResult,
  };
}

/** 导出数据集（JSONL）到本机 */
export async function dataExport(opts = {}) {
  const { app = '', format = 'jsonl' } = opts;
  const records = listRecords().filter((r) => (app ? r.app === app : true));
  const outFile = path.join(FLYWHEEL_DIR, `export-${Date.now()}.${format}`);
  if (format === 'jsonl') {
    const lines = records.map((r) => JSON.stringify(r)).join('\n');
    fs.writeFileSync(outFile, lines);
  } else {
    fs.writeFileSync(outFile, JSON.stringify(records, null, 2));
  }
  return { ok: true, count: records.length, file: outFile, format };
}

/** 统计指标 */
export async function dataMetrics() {
  const records = listRecords();
  const total = records.length;
  const success = records.filter((r) => r.result === 'success' || (!r.error && r.result)).length;
  const failed = records.filter((r) => r.error || r.result === 'fail').length;
  const failures = {};
  for (const r of records) {
    if (r.error) {
      const key = r.error.slice(0, 40);
      failures[key] = (failures[key] || 0) + 1;
    }
  }
  return {
    ok: true,
    total,
    success,
    failed,
    successRate: total > 0 ? Math.round((success / total) * 100) : 0,
    failureTypes: Object.entries(failures).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

/** 回放操作序列 */
export async function replayActions(opts = {}) {
  const { file = '', speed = 1 } = opts;
  let actions;
  if (file) {
    try {
      actions = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(actions)) actions = [actions];
    } catch (e) {
      return { ok: false, error: `cannot read replay file: ${e.message}` };
    }
  } else {
    // 默认回放最近一条记录（若有 ui_tree/action）
    const records = listRecords();
    const last = records[records.length - 1];
    if (!last) return { ok: false, error: 'no records to replay' };
    actions = [last];
  }
  return {
    ok: true,
    count: actions.length,
    speed,
    actions: actions.map((a) => ({
      app: a.app,
      action: a.action,
      result: a.result,
      screen_label: a.screen_label,
    })),
    note: 'replay sequence prepared; actual execution via input tools (tap/swipe)',
  };
}

/** 验证数据集完整 */
export async function dataVerify() {
  const records = listRecords();
  const parseable = records.filter((r) => !r.error);
  return {
    ok: parseable.length === records.length,
    total: records.length,
    parseable: parseable.length,
    unparseable: records.length - parseable.length,
  };
}
