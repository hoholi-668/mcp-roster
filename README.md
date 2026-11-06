# mcp-roster

> 人物名册：**只登记加了私聊好友的人**，默认拒绝，给别的工具当权限来源。

## 解决什么问题

做角色 AI / 群机器人时，「这个人是谁、能不能跟他开玩笑、能不能动他的空间」
通常散落在三四个地方：桥接的白名单、提示词里的人物备注、某段硬编码的分档。

改一个人要改三处，忘一处就出事。

**这个服务把它们收成一份文件：**

```
roster.json  →  谁能私聊我 / 谁能看我空间 / 谁只能正经说话
```

别的工具（QQ 空间 MCP、调度器）都来问它一句。

---

## 数据模型

```json
{
  "version": 1,
  "people": {
    "2548408348": {
      "uin": "2548408348",
      "name": "老大",
      "relation": "主人",
      "tone": "可以撒娇，但要接住他的话",
      "tier": "T0",
      "notes": ["在意我记不记得他"],
      "perms": { "dm": true, "qzone": true },
      "createdAt": 1793000000000,
      "updatedAt": 1793978000000
    }
  }
}
```

| 字段 | 说明 |
|---|---|
| `tier` | `T0` 自己人 / `T1` 熟人 / `T2` 路人（默认） / `T3` 雷区 |
| `perms.dm` | 能不能私聊 |
| `perms.qzone` | 能不能看/动他的空间 |
| `perms.group` | 群里能不能主动找他说话 |
| `notes` | 备注，最多 50 条，去重 |

**默认拒绝**：不在 `perms` 里显式写 `true`，就是没权限。

---

## 七个工具

| 工具 | 作用 |
|---|---|
| `roster_list` | 名册摘要（分档、权限、最后一条备注） |
| `roster_get` | 某个人的完整定义 |
| `roster_upsert` | 加人 / 改定义 / 改权限 |
| `roster_note` | 追加备注（去重） |
| `roster_remove` | 删人（权限立刻失效） |
| `roster_check` | 某人有没有某项权限（默认拒绝） |
| `roster_allowlist` | 导出某类权限下所有人的号，直接当白名单用 |

---

## 快速开始

```bash
npm install
ROSTER_FILE=~/.dsh/roster.json npm start
```

接进 MCP 客户端：

```yaml
- id: mcp-roster
  name: '@deepseek-ai/dsh-mcp'
  config:
    command: npx
    args: ['-y', 'mcp-roster']
    env:
      ROSTER_FILE: /root/.dsh/roster.json
```

## 从桥接迁移

如果你已经有 `friends.json`：

```bash
node scripts/import-friends.mjs /opt/qq-bridge/state/friends.json --owner 你的QQ号
```

| 规则 | 说明 |
|---|---|
| 你自己（`--owner`） | 设为 T0，给 `dm + qzone` |
| 其他人 | 默认 T2、**无权限** |
| 想批量给空间权限 | 加 `--grant-qzone`（谨慎） |

**迁移只读旧文件，不改它。**

---

## 别的工具怎么用它

### 方式一：MCP 调用

```js
const { allowed } = await callTool('roster_check', { uin, scope: 'qzone' });
if (!allowed) return '拒绝：不在名册里';
```

### 方式二：直接读文件（省一次调用）

```js
import { loadRoster, can } from 'mcp-roster/src/store.js';
const roster = loadRoster('/root/.dsh/roster.json');
if (!can(roster, uin, 'qzone')) return '拒绝';
```

### 方式三：导出白名单

```js
const { uins } = await callTool('roster_allowlist', { scope: 'qzone' });
// 直接喂给 qzone-mcp 的 allowUins
```

---

## 设计取舍

| 决定 | 为什么 |
|---|---|
| **默认拒绝** | 漏加一个人只是「他不被支持」，而不是「他被放开了」 |
| **权限是覆盖式** | 传了 `perms` 就整体替换，不做合并——合并会让撤销权限很难 |
| **每次操作重读文件** | 多个进程共用一份名册，避免内存态互相覆盖 |
| **原子写**（临时文件 + rename） | 写一半断电不会得到半个 JSON |
| **坏文件退回空名册** | 宁可所有人都没权限，也不要启动失败 |
| **只登记私聊好友** | 群成员是动态的，不该混进「我认识谁」 |

---

## 验证过的场景

| 层 | 结果 |
|---|---|
| 单元测试 | **10/10**（存储、权限、备注、排序、坏文件） |
| MCP 协议层 | **13/13**（真实拉起服务，逐个工具调用） |
| 迁移脚本 | ✅ 真跑过 friends.json 格式 |

遇到问题看 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。

---

## 许可

MIT © 2026 HOHOLI
