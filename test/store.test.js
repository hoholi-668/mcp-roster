import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadRoster, saveRoster, normalizePerson, upsertPerson,
  appendNote, removePerson, can, uinsWith, summarize, SCOPES
} from '../src/store.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'roster-')), 'roster.json');
}

test('空名册：文件不存在也不抛错', () => {
  const r = loadRoster('/nonexistent/roster.json');
  assert.deepEqual(r.people, {});
  assert.equal(loadRoster('').people && Object.keys(loadRoster('').people).length, 0);
});

test('规整：只保留认识的字段，未知权限被丢弃', () => {
  const p = normalizePerson({
    uin: '12345678',
    name: '  阿蓝  ',
    relation: '朋友',
    tone: '可以怼',
    tier: 'T9',            // 非法档位 → 默认 T2
    perms: { qzone: true, dm: false, admin: true },  // admin 不认识
    notes: ['  喜欢猫  ', '', 123]
  });
  assert.equal(p.uin, '12345678');
  assert.equal(p.name, '阿蓝');
  assert.equal(p.tier, 'T2');
  assert.deepEqual(p.perms, { qzone: true });   // 只留 true 的已知 scope
  assert.deepEqual(p.notes, ['喜欢猫', '123']);
  assert.equal(p.relation, '朋友');
});

test('规整：QQ 号不合法直接报错', () => {
  assert.throws(() => normalizePerson({ uin: 'abc' }), /QQ 号不合法/);
  assert.throws(() => normalizePerson({}), /QQ 号不合法/);
  assert.throws(() => normalizePerson({ uin: '123' }), /QQ 号不合法/);
});

test('新增与更新：createdAt 保留，updatedAt 刷新', () => {
  const r = loadRoster(tmpFile());
  const a = upsertPerson(r, { uin: '10001', name: '甲', perms: { dm: true } });
  assert.equal(a.created, true);
  const createdAt = a.person.createdAt;

  const b = upsertPerson(r, { uin: '10001', name: '甲改名', perms: { qzone: true } });
  assert.equal(b.created, false);
  assert.equal(b.person.createdAt, createdAt);
  assert.equal(b.person.name, '甲改名');
  assert.deepEqual(b.person.perms, { qzone: true });  // 覆盖，不是合并
});

test('备注：追加、去重、空备注报错、不存在的号报错', () => {
  const r = loadRoster(tmpFile());
  upsertPerson(r, { uin: '10001', name: '甲' });

  appendNote(r, '10001', '喜欢猫');
  appendNote(r, '10001', '喜欢猫');       // 重复，不加
  appendNote(r, '10001', '讨厌被叫外号');
  assert.deepEqual(r.people['10001'].notes, ['喜欢猫', '讨厌被叫外号']);

  assert.throws(() => appendNote(r, '10001', '   '), /备注不能为空/);
  assert.throws(() => appendNote(r, '99999', 'x'), /名册里没有/);
});

test('删除：存在返回 true，不存在返回 false', () => {
  const r = loadRoster(tmpFile());
  upsertPerson(r, { uin: '10001', name: '甲' });
  assert.equal(removePerson(r, '10001'), true);
  assert.equal(removePerson(r, '10001'), false);
});

test('权限：默认拒绝，只认显式 true', () => {
  const r = loadRoster(tmpFile());
  upsertPerson(r, { uin: '10001', name: '甲', perms: { dm: true } });

  assert.equal(can(r, '10001', 'dm'), true);
  assert.equal(can(r, '10001', 'qzone'), false);
  assert.equal(can(r, '99999', 'dm'), false);      // 不在名册
  assert.equal(can(r, '10001', 'admin'), false);   // 未知 scope
  assert.deepEqual(uinsWith(r, 'dm'), ['10001']);
  assert.deepEqual(uinsWith(r, 'qzone'), []);
});

test('存取：写进去能读出来，坏文件退回空名册', () => {
  const file = tmpFile();
  const r = loadRoster(file);
  upsertPerson(r, { uin: '10001', name: '甲', perms: { qzone: true } });
  saveRoster(file, r);

  const back = loadRoster(file);
  assert.equal(back.people['10001'].name, '甲');
  assert.equal(can(back, '10001', 'qzone'), true);

  fs.writeFileSync(file, '{ 坏掉的 json');
  assert.deepEqual(loadRoster(file).people, {});
});

test('摘要：按档位排序，带权限列表和最后一条备注', () => {
  const r = loadRoster(tmpFile());
  upsertPerson(r, { uin: '10001', name: '路人', tier: 'T2' });
  upsertPerson(r, { uin: '10002', name: '熟人', tier: 'T1', perms: { dm: true, qzone: true } });
  appendNote(r, '10002', '在意记性');

  const s = summarize(r);
  assert.equal(s.total, 2);
  assert.equal(s.people[0].name, '熟人');     // T1 排在 T2 前
  assert.deepEqual(s.people[0].perms.sort(), ['dm', 'qzone']);
  assert.equal(s.people[0].lastNote, '在意记性');
  assert.equal(s.people[1].lastNote, '');
});

test('SCOPES 与实现一致', () => {
  assert.deepEqual(SCOPES, ['dm', 'qzone', 'group']);
});
