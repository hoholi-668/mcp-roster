#!/usr/bin/env node
// MCP 协议层自测：真的把服务拉起来，用官方客户端调每一个工具。
//
// 用法：node scripts/selftest-mcp.mjs
// 需要先 npm install（要 @modelcontextprotocol/sdk）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-mcp-'));
const rosterFile = path.join(dir, 'roster.json');

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); return true; }
  fail += 1; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  return false;
}

const client = new Client({ name: 'roster-selftest', version: '0.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.join(import.meta.dirname, '../src/index.js')],
  env: { ...process.env, ROSTER_FILE: rosterFile }
}));

const textOf = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const jsonOf = (r) => { try { return JSON.parse(textOf(r)); } catch { return null; } };

try {
  console.log('\n[1] 工具清单');
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  const want = ['roster_allowlist', 'roster_check', 'roster_get', 'roster_list', 'roster_note', 'roster_remove', 'roster_upsert'];
  ok('七个工具都在', want.every((n) => tools.includes(n)), tools.join(', '));

  console.log('\n[2] 初始为空');
  const empty = jsonOf(await client.callTool({ name: 'roster_list', arguments: {} }));
  ok('空名册 total=0', empty?.total === 0);

  console.log('\n[3] 加人');
  const add = jsonOf(await client.callTool({
    name: 'roster_upsert',
    arguments: { uin: '10000001', name: '阿蓝', relation: '朋友', tone: '可以怼', tier: 'T1', perms: { dm: true } }
  }));
  ok('创建成功', add?.ok === true && add?.created === true, add?.person?.name);
  ok('权限只留认识的', JSON.stringify(add?.person?.perms) === '{"dm":true}');

  console.log('\n[4] 读回');
  const got = jsonOf(await client.callTool({ name: 'roster_get', arguments: { uin: '10000001' } }));
  ok('拿到完整定义', got?.name === '阿蓝' && got?.tier === 'T1');

  console.log('\n[5] 备注');
  const note = jsonOf(await client.callTool({ name: 'roster_note', arguments: { uin: '10000001', note: '喜欢猫' } }));
  ok('备注写入', note?.notes?.includes('喜欢猫'));

  console.log('\n[6] 权限判定（默认拒绝）');
  const allowDm = jsonOf(await client.callTool({ name: 'roster_check', arguments: { uin: '10000001', scope: 'dm' } }));
  const denyQzone = jsonOf(await client.callTool({ name: 'roster_check', arguments: { uin: '10000001', scope: 'qzone' } }));
  const denyUnknown = jsonOf(await client.callTool({ name: 'roster_check', arguments: { uin: '99999999', scope: 'dm' } }));
  ok('dm 允许', allowDm?.allowed === true);
  ok('qzone 拒绝', denyQzone?.allowed === false);
  ok('不在名册的人拒绝', denyUnknown?.allowed === false);

  console.log('\n[7] 白名单导出');
  const list = jsonOf(await client.callTool({ name: 'roster_allowlist', arguments: { scope: 'dm' } }));
  ok('dm 白名单只含 1 人', list?.count === 1 && list?.uins?.[0] === '10000001');

  console.log('\n[8] 删除后立刻失去权限');
  const del = jsonOf(await client.callTool({ name: 'roster_remove', arguments: { uin: '10000001' } }));
  const afterDel = jsonOf(await client.callTool({ name: 'roster_check', arguments: { uin: '10000001', scope: 'dm' } }));
  ok('删除成功', del?.removed === true);
  ok('权限已失效', afterDel?.allowed === false);

  console.log('\n[9] 非法输入');
  const bad = await client.callTool({ name: 'roster_upsert', arguments: { uin: 'abc', name: 'x' } });
  ok('非法 QQ 号报错', bad.isError === true, textOf(bad).slice(0, 40));
} catch (error) {
  console.error('❌ 协议层失败：', error?.message ?? error);
  fail += 1;
} finally {
  try { await client.close(); } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exitCode = fail ? 1 : 0;
