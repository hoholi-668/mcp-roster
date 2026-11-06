# 排错手册

---

## 所有人都被拒绝

**这是默认行为**，不是 bug。名册里没写 `perms` 就没权限。

**检查**：

```bash
node -e "import('./src/store.js').then(m=>{const r=m.loadRoster(process.env.ROSTER_FILE);console.log(m.summarize(r))})"
```

看 `perms` 是不是空数组。

**处理**：给需要的人加权限。

```json
{ "uin": "10001", "perms": { "qzone": true } }
```

---

## 名册文件在哪

默认 `~/.dsh/roster.json`，可以用环境变量覆盖：

```bash
export ROSTER_FILE=/root/.dsh/roster.json
```

**症状**：改了一个文件但没生效 → 检查两个进程是不是指向同一个文件。

```bash
ps aux | grep mcp-roster
```

---

## 名册文件坏了

**行为**：`loadRoster` 读失败时返回**空名册**——所有人失去权限，但服务不崩。

**为什么这么设计**：宁可没人有权限，也不要启动失败或按坏了的数据放权。

**处理**：

```bash
# 看看是不是 JSON 语法问题
python3 -m json.tool ~/.dsh/roster.json > /dev/null && echo OK
```

有备份就从备份恢复；没有就重新加人（名册很小，重建很快）。

---

## 加人报「QQ 号不合法」

**规则**：5~12 位纯数字。

| 输入 | 结果 |
|---|---|
| `10001` | ✅ |
| `1000112345678`（13 位） | ❌ 太长 |
| `abc123` | ❌ 非数字 |
| `" 10001 "` | ✅ 有 trim |

---

## 权限加了但不生效

### 1. 检查是不是「覆盖」而不是「合并」

`roster_upsert` 传 `perms` 是**整体替换**：

```json
// 原来是 { dm: true, qzone: true }
{ "perms": { "qzone": true } }   // 结果只剩 qzone，dm 没了
```

**这是故意的**——合并语义会让「撤销权限」变得几乎不可能。

### 2. 检查调用方缓存了旧白名单

如果别的工具启动时读了一次 `roster_allowlist`，之后名册变了它不会自动刷新。

**处理**：重启那个工具，或改成每次动手前调 `roster_check`。

---

## 迁移后有人没进来

`import-friends.mjs` 只处理 `friends.json` 里**对象形式**的条目。

| 情况 | 结果 |
|---|---|
| `{ "10001": { "name": "甲" } }` | ✅ |
| `{ "10001": "甲" }`（字符串） | ❌ 跳过 |
| 数组形式 | ❌ 跳过 |

**处理**：手动 `roster_upsert` 补进去。

---

## 多人同时改名册

**行为**：每次操作都重新读盘，写是原子的（临时文件 + rename）。

**但**：两个进程同时「读-改-写」可能丢失一次更新（最后写的赢）。

**处理**：

- 名册改动不频繁的话，忽略即可
- 需要严格并发就加文件锁，或统一走一个进程

---

## 和 qzone-mcp 的白名单对不上

**原因**：`qzone-mcp` 用的是自己的 `allowUins`，不会自动读名册。

**处理**（任选）：

1. 用 `roster_allowlist` 导出，写进 `qzone-mcp.json` 的 `allowUins`
2. 或改 `qzone-mcp` 让它调 `roster_check`

**注意**：两边同时维护会分叉，**建议只留一处权威**。

---

## 还是不行

1. 打印实际读到的名册：

```bash
ROSTER_FILE=~/.dsh/roster.json node -e "
import('./src/store.js').then(m=>{
  const r=m.loadRoster(process.env.ROSTER_FILE);
  console.log('人数', Object.keys(r.people).length);
  console.log(JSON.stringify(m.summarize(r), null, 2));
})"
```

2. 直接测权限：

```bash
ROSTER_FILE=~/.dsh/roster.json node -e "
import('./src/store.js').then(m=>{
  const r=m.loadRoster(process.env.ROSTER_FILE);
  console.log('qzone:', m.uinsWith(r,'qzone'));
})"
```

3. 两个命令结果对、工具里不对 → 检查 `ROSTER_FILE` 环境变量是否一致。
