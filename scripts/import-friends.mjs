#!/usr/bin/env node
// 把桥接的 friends.json 迁移进名册（一次性）。
//
// friends.json 结构（qq-bridge）：
//   { "2548408348": { "name": "老大", "relation": "主人", "tone": "...", "notes": [...] } }
//
// 迁移规则：
//   · 所有条目默认 T2 路人，不给任何权限（安全）
//   · 你自己（--owner 指定）默认 T0，给 dm + qzone 权限
//   · 其余人需要手动改权限：node scripts/import-friends.mjs --grant-qzone
//
// 用法：
//   node scripts/import-friends.mjs /opt/qq-bridge/state/friends.json --owner 2548408348

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRoster, saveRoster, upsertPerson } from '../src/store.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) || '/opt/qq-bridge/state/friends.json';
const ownerIdx = args.indexOf('--owner');
const owner = ownerIdx >= 0 ? String(args[ownerIdx + 1] || '') : '';
const grantQzone = args.includes('--grant-qzone');
const out = process.env.ROSTER_FILE || path.join(os.homedir(), '.dsh', 'roster.json');

if (!fs.existsSync(file)) {
  console.error(`找不到 friends.json：${file}`);
  process.exit(1);
}
const friends = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
const roster = loadRoster(out);

let added = 0;
let updated = 0;
for (const [uin, p] of Object.entries(friends)) {
  if (!p || typeof p !== 'object') continue;
  const isOwner = owner && String(uin) === owner;
  const before = roster.people[String(uin)];
  const perms = isOwner
    ? { dm: true, qzone: true }
    : (grantQzone ? { dm: true, qzone: true } : (before?.perms ?? {}));
  const { created } = upsertPerson(roster, {
    uin,
    name: p.name || before?.name || '',
    relation: p.relation || before?.relation || '',
    tone: p.tone || before?.tone || '',
    tier: isOwner ? 'T0' : (before?.tier || 'T2'),
    notes: Array.isArray(p.notes) ? p.notes : (before?.notes ?? []),
    perms,
    createdAt: before?.createdAt
  });
  if (created) added += 1; else updated += 1;
}
saveRoster(out, roster);
console.log(`迁移完成：新增 ${added}，更新 ${updated}，写入 ${out}`);
console.log(owner ? `主人 ${owner} 已设为 T0 并给 dm+qzone` : '未指定 --owner，所有人默认 T2 无权限');
