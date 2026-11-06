#!/usr/bin/env node
// mcp-roster —— 人物名册 MCP。
//
// 只登记「加了私聊好友」的人。别的工具（QQ 空间、群聊调度）靠它判断
// 「这个人能不能碰」，默认拒绝。
//
// 环境变量：
//   ROSTER_FILE  名册文件路径，默认 ~/.dsh/roster.json

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  loadRoster, saveRoster, upsertPerson, appendNote, removePerson,
  can, uinsWith, summarize, SCOPES, TIERS
} from './store.js';

const ROSTER_FILE = process.env.ROSTER_FILE || path.join(os.homedir(), '.dsh', 'roster.json');

const text = (value, isError = false) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {})
});

/** 每次操作都重新读盘：多个进程共用一份名册时不会互相覆盖。 */
function read() { return loadRoster(ROSTER_FILE); }
function write(roster) { saveRoster(ROSTER_FILE, roster); }

const server = new McpServer({ name: 'mcp-roster', version: '0.1.0' });

server.tool(
  'roster_list',
  '列出名册里的人（分档、权限、最近一条备注）。用来知道「我认识谁、能对谁做什么」。',
  {},
  async () => text(summarize(read()))
);

server.tool(
  'roster_get',
  '看某个人的完整定义：称呼、关系、说话语气、备注、权限。',
  { uin: z.string().describe('QQ 号') },
  async ({ uin }) => {
    const person = read().people[String(uin)];
    if (!person) return text(`名册里没有 ${uin}`, true);
    return text(person);
  }
);

server.tool(
  'roster_upsert',
  '加一个人或改他的定义。权限是覆盖式的：传了 perms 就整体替换，不传则保留原权限。',
  {
    uin: z.string().describe('QQ 号'),
    name: z.string().optional().describe('怎么称呼他'),
    relation: z.string().optional().describe('关系，例如「主人」「朋友」'),
    tone: z.string().optional().describe('跟他说话的语气提示'),
    tier: z.enum(TIERS).optional().describe('T0 自己人 / T1 熟人 / T2 路人（默认） / T3 雷区'),
    perms: z.record(z.boolean()).optional().describe('权限：dm 私聊 / qzone 空间 / group 群聊，只认 true')
  },
  async ({ uin, name, relation, tone, tier, perms }) => {
    try {
      const roster = read();
      const before = roster.people[String(uin)];
      const merged = {
        uin,
        name: name ?? before?.name ?? '',
        relation: relation ?? before?.relation ?? '',
        tone: tone ?? before?.tone ?? '',
        tier: tier ?? before?.tier ?? 'T2',
        notes: before?.notes ?? [],
        perms: perms ? perms : (before?.perms ?? {}),
        createdAt: before?.createdAt
      };
      const { person, created } = upsertPerson(roster, merged);
      write(roster);
      return text({ ok: true, created, person });
    } catch (error) {
      return text(`保存失败：${error?.message ?? error}`, true);
    }
  }
);

server.tool(
  'roster_note',
  '给某个人追加一条备注（自动去重，最多留 50 条）。',
  {
    uin: z.string().describe('QQ 号'),
    note: z.string().describe('要记的事，例如「不喜欢被叫外号」')
  },
  async ({ uin, note }) => {
    try {
      const roster = read();
      const person = appendNote(roster, uin, note);
      write(roster);
      return text({ ok: true, notes: person.notes });
    } catch (error) {
      return text(`记备注失败：${error?.message ?? error}`, true);
    }
  }
);

server.tool(
  'roster_remove',
  '把人从名册里删掉。删掉后他立刻失去所有权限。',
  { uin: z.string().describe('QQ 号') },
  async ({ uin }) => {
    const roster = read();
    const removed = removePerson(roster, uin);
    if (removed) write(roster);
    return text({ ok: true, removed });
  }
);

server.tool(
  'roster_check',
  '判断某个人有没有某项权限（默认拒绝）。别的工具在动手前应该先问一句。',
  {
    uin: z.string().describe('QQ 号'),
    scope: z.enum(SCOPES).describe('dm 私聊 / qzone 空间 / group 群聊')
  },
  async ({ uin, scope }) => {
    const roster = read();
    return text({ uin: String(uin), scope, allowed: can(roster, uin, scope) });
  }
);

server.tool(
  'roster_allowlist',
  '导出某类权限下所有人的 QQ 号。可以直接当白名单喂给别的工具。',
  { scope: z.enum(SCOPES).describe('dm / qzone / group') },
  async ({ scope }) => {
    const uins = uinsWith(read(), scope);
    return text({ scope, count: uins.length, uins });
  }
);

await server.connect(new StdioServerTransport());
console.error(`[mcp-roster] ready — file=${ROSTER_FILE} people=${Object.keys(read().people).length}`);
