// 名册存储：一个 JSON 文件，纯函数操作，方便单测和备份。
//
// 设计原则：
//   · 默认拒绝——不在名册里的人没有任何权限
//   · 只有显式写进 perms 的能力才生效
//   · 名册只登记「加了私聊好友」的人，不是群成员列表

import fs from 'node:fs';
import path from 'node:path';

/** 允许的权限项。加新的这里要同步。 */
export const SCOPES = ['dm', 'qzone', 'group'];

/** 允许的关系档位。 */
export const TIERS = ['T0', 'T1', 'T2', 'T3'];

const EMPTY = { version: 1, people: {} };

/** 读名册；文件不存在/损坏都返回空名册（不抛错）。 */
export function loadRoster(file) {
  if (!file) return { ...EMPTY, people: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || typeof raw.people !== 'object' || !raw.people) {
      return { ...EMPTY, people: {} };
    }
    return { version: Number(raw.version) || 1, people: { ...raw.people } };
  } catch {
    return { ...EMPTY, people: {} };
  }
}

/** 原子写：先写临时文件再 rename，避免半个文件。 */
export function saveRoster(file, roster) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(roster, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** 规整一个人：只保留认识的字段，权限只保留认识的 scope。 */
export function normalizePerson(input = {}) {
  const uin = String(input.uin ?? '').trim();
  if (!/^\d{5,12}$/.test(uin)) throw new Error(`QQ 号不合法：${uin || '(空)'}`);

  const perms = {};
  for (const scope of SCOPES) {
    if (input.perms?.[scope] === true) perms[scope] = true;
  }
  const tier = TIERS.includes(input.tier) ? input.tier : 'T2';
  const notes = Array.isArray(input.notes)
    ? input.notes.map((n) => String(n).trim()).filter(Boolean).slice(-50)
    : [];

  return {
    uin,
    name: String(input.name ?? '').trim().slice(0, 40),
    relation: String(input.relation ?? '').trim().slice(0, 40),
    tone: String(input.tone ?? '').trim().slice(0, 200),
    tier,
    notes,
    perms,
    updatedAt: Date.now(),
    createdAt: Number(input.createdAt) || Date.now()
  };
}

/**
 * 新增或更新一个人。
 * @returns {{person:object, created:boolean}}
 */
export function upsertPerson(roster, input) {
  const person = normalizePerson(input);
  const existed = Boolean(roster.people[person.uin]);
  if (existed) person.createdAt = roster.people[person.uin].createdAt || person.createdAt;
  roster.people[person.uin] = person;
  return { person, created: !existed };
}

/** 追加一条备注（去重，最多留 50 条）。 */
export function appendNote(roster, uin, note) {
  const key = String(uin);
  const person = roster.people[key];
  if (!person) throw new Error(`名册里没有 ${key}`);
  const text = String(note ?? '').trim();
  if (!text) throw new Error('备注不能为空');
  if (!person.notes.includes(text)) person.notes.push(text.slice(0, 200));
  person.notes = person.notes.slice(-50);
  person.updatedAt = Date.now();
  return person;
}

export function removePerson(roster, uin) {
  const key = String(uin);
  if (!roster.people[key]) return false;
  delete roster.people[key];
  return true;
}

/**
 * 权限判定：默认拒绝。
 * 只认 person.perms[scope] === true。
 */
export function can(roster, uin, scope) {
  const person = roster.people[String(uin)];
  return Boolean(person && person.perms?.[scope] === true);
}

/** 某类权限下所有人的号（给别的工具生成白名单用）。 */
export function uinsWith(roster, scope) {
  return Object.values(roster.people).filter((p) => p.perms?.[scope] === true).map((p) => p.uin);
}

/** 列表摘要：不返回全部备注，避免 prompt 过长。 */
export function summarize(roster) {
  // 档位从近到远：T0 自己人 → T3 雷区；同档按 QQ 号稳定排序
  const people = Object.values(roster.people).sort(
    (a, b) => (a.tier || 'T2').localeCompare(b.tier || 'T2') || a.uin.localeCompare(b.uin)
  );
  return {
    total: people.length,
    people: people.map((p) => ({
      uin: p.uin,
      name: p.name,
      relation: p.relation,
      tier: p.tier,
      perms: Object.keys(p.perms || {}),
      noteCount: (p.notes || []).length,
      lastNote: (p.notes || [])[p.notes.length - 1] || ''
    }))
  };
}
