// layout.js — uiautomator dump → 简化布局树
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './config.js';
import { runAdb } from './adb.js';

const DUMP_REMOTE = '/sdcard/window_dump.xml';

/** 简化节点：过滤纯容器（无 id/text/desc 且不可交互） */
export function simplifyNode(node, depth = 0, maxDepth = 20) {
  if (depth > maxDepth) return null;
  const attrs = node.attributes || {};
  const id = attrs['resource-id'] || '';
  const cls = attrs['class'] || '';
  const text = attrs['text'] || '';
  const desc = attrs['content-desc'] || '';
  const clickable = attrs['clickable'] === 'true';
  const focusable = attrs['focusable'] === 'true';
  const scrollable = attrs['scrollable'] === 'true';
  const boundsRaw = attrs['bounds'] || '';
  const selected = attrs['selected'] === 'true';
  const checked = attrs['checked'] === 'true';
  const enabled = attrs['enabled'] !== 'false';

  const bounds = parseBounds(boundsRaw);
  const isContainer =
    !id && !text && !desc && !clickable && !focusable && !scrollable;

  const out = {
    id,
    class: cls,
    text,
    desc,
    bounds,
    clickable,
    focusable,
    scrollable,
    selected,
    checked,
    enabled,
  };
  if (bounds) out.center = centerOf(bounds);

  const children = (node.children || [])
    .map((c) => simplifyNode(c, depth + 1, maxDepth))
    .filter(Boolean);

  // 过滤纯容器节点（无 id/text/desc 且不可交互 且无有效子节点）
  if (isContainer && children.length === 0) return null;
  if (isContainer) {
    // 容器但保留子节点：拍平成子节点（避免噪音层）
    return children.length === 1 ? children[0] : { ...out, children };
  }
  if (children.length > 0) out.children = children;
  return out;
}

/** 解析 bounds="[x1,y1][x2,y2]" */
export function parseBounds(raw) {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(raw || '');
  if (!m) return null;
  const [x1, y1, x2, y2] = [1, 2, 3, 4].map((i) => parseInt(m[i], 10));
  return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
}

export function centerOf(b) {
  return { x: Math.round((b.x1 + b.x2) / 2), y: Math.round((b.y1 + b.y2) / 2) };
}

/**
 * 抓取当前界面简化布局树
 * @param {{timeout?: number, save?: boolean}} opts
 * @returns {Promise<{ok: boolean, activity?: string, tree?: object, flattened?: object[], source?: string, error?: string}>}
 */
export async function dumpLayoutTree(opts = {}) {
  const timeout = opts.timeout ?? config.timeouts.dump;
  // 1. 设备端 dump（root 提升权限到全量）
  const dumpR = await runAdb(['shell', 'uiautomator', 'dump', DUMP_REMOTE], { timeout });
  if (dumpR.code !== 0) {
    return { ok: false, error: `uiautomator dump failed: ${dumpR.stderr.trim() || dumpR.stdout.trim()}` };
  }

  // 2. pull 到本地
  const localPath = path.join(config.outputDir, 'layouts', `dump-${Date.now()}.xml`);
  const pullR = await runAdb(['pull', DUMP_REMOTE, localPath], { timeout });
  if (pullR.code !== 0) {
    return { ok: false, error: `pull failed: ${pullR.stderr.trim() || pullR.stdout.trim()}` };
  }

  // 3. 解析 XML
  try {
    const xml = fs.readFileSync(localPath, 'utf8');
    const root = parseXmlSimple(xml);
    if (!root) return { ok: false, error: 'failed to parse uiautomator XML' };
    const activity = (root.attributes && root.attributes['package']) || '';

    // 4. 简化
    const tree = simplifyNode(root);
    const flattened = [];
    flattenTree(tree, flattened);

    const result = {
      ok: true,
      activity,
      source: 'uiautomator',
      tree,
      flattened,
      nodeCount: flattened.length,
    };
    if (opts.save === false) {
      try { fs.unlinkSync(localPath); } catch {}
    }
    return result;
  } catch (e) {
    return { ok: false, error: `XML parse error: ${e.message}` };
  }
}

/** 拍平树为列表（便于 Agent 扫描） */
function flattenTree(node, out, depth = 0) {
  if (!node) return;
  const copy = { ...node };
  delete copy.children;
  copy.depth = depth;
  out.push(copy);
  for (const c of node.children || []) flattenTree(c, out, depth + 1);
}

/** 提取可交互元素 */
export function extractInteractive(layoutResult) {
  if (!layoutResult.ok) return { ok: false, error: layoutResult.error };
  const out = [];
  const walk = (node) => {
    if (!node) return;
    const interactive = node.clickable || node.scrollable || (node.class && /EditText|ScrollView|ListView/.test(node.class));
    if (interactive) {
      out.push({
        id: node.id,
        text: node.text,
        desc: node.desc,
        class: node.class,
        bounds: node.bounds,
        center: node.center,
        type: node.class ? node.class.split('.').pop() : 'other',
      });
    }
    for (const c of node.children || []) walk(c);
  };
  walk(layoutResult.tree);
  return { ok: true, count: out.length, elements: out };
}

/**
 * 极简 XML 解析（uiautomator dump 结构已知：<node .../> 嵌套）
 * 返回 { tag, attributes, children }
 */
export function parseXmlSimple(xml) {
  // 去掉 XML 头
  const body = xml.replace(/<\?xml[^>]*\?>/, '').trim();
  const stack = [];
  let root = null;
  const tagRe = /<([a-zA-Z0-9_-]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(body)) !== null) {
    const tag = m[1];
    const attrsRaw = m[2];
    const selfClose = m[3] === '/';
    const node = { tag, attributes: parseAttrs(attrsRaw), children: [] };
    if (root === null) {
      root = node;
      stack.push(node);
    } else {
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      if (!selfClose) stack.push(node);
    }
    if (selfClose) {
      // 不压栈
    } else {
      // 遇到 </tag> 时弹栈；简化：tagRe 已消费开标签，闭合标签在下次匹配跳过
    }
  }
  // 处理闭合：极简方案下用标签配平重扫
  return balanceNodes(body) || root;
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z0-9-_:]+)=["']([^"']*)["']/g;
  let m;
  while ((m = re.exec(raw)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

/** 正确配平开闭标签，构建层级 */
function balanceNodes(body) {
  const stack = [];
  let root = null;
  const tokenRe = /<([a-zA-Z0-9_-]+)([^>]*?)(\/?)>|<\/([a-zA-Z0-9_-]+)>/g;
  let m;
  while ((m = tokenRe.exec(body)) !== null) {
    if (m[4]) {
      // 闭合标签
      stack.pop();
    } else {
      const tag = m[1];
      const selfClose = m[3] === '/';
      const node = { tag, attributes: parseAttrs(m[2]), children: [] };
      if (root === null) {
        root = node;
      } else if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else {
        root = node;
      }
      if (!selfClose) stack.push(node);
    }
  }
  return root;
}
