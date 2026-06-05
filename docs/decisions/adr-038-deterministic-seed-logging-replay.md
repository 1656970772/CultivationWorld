# ADR-038：确定性种子 + 日志落盘 + 重放

最后更新：2026-06-02

状态：已实现（确定性 RNG 收拢 23 个文件、种子贯通 init→ctx→实体、serve.py 落盘接口、客户端 ReplayRecorder、确定性验证工具通过）

## 背景

长周期自治世界要可调试、可复盘，必须满足两点：**同一局可逐字节复现**、**世界事件可落盘离线分析**。
此前模拟随机散落在 23 个文件、约 80 处 `Math.random()`，无统一随机源，导致：

- 无法复现某局的演化（每次运行都不同），bug 难定位、调参无法 A/B 对照。
- 浏览器无法直接写本地磁盘，事件日志只能停留在内存/控制台，无法离线分析或长期归档。
- 仅有的确定性手段是测试工具里 monkeypatch 全局 `Math.random`（见旧 `refactor-baseline.mjs`），
  脆弱且不能用于线上运行。

目标（用户明确要求）：**做日志落盘 + 重放 + 确定性种子**；并明确**不使用配置摘要做重放校验**。

## 决策

### 一、确定性种子 RNG（基础）

新增 `apps/game/js/engine/abstract/rng.js`：`Rng` 类，mulberry32 算法（32 位状态、`Math.imul` 位运算风格，
与 `territory-layout-generator.js` 既有的 `hashNoise` 一致）。API 覆盖现有全部用法：
`next()` / `float(min,max)` / `int(min,max)` / `chance(p)` / `bool()` / `pick(arr)` / `shuffle(arr)`，
并提供 `fn()`（返回 `() => number`，无缝替换接受 `randomFn = Math.random` 的旧接口）、
`derive(label)`（派生隔离子流）、`getState/setState`（状态可序列化）。

**约定**：模拟逻辑一律从随机源取随机；渲染/UI 等非模拟代码不受约束，可继续用 `Math.random`。

### 二、种子贯通（init → worldContext → 实体）

- `WorldEngine.init(configs)` 读取 `configs.seed`（缺省则 `Rng.makeSeed()` 生成并记录），创建 `this.rng`。
- `this.rng` 注入 `TickManager`，由 `WorldContextBuilder` 挂到每 tick 的 `worldContext.rng`，
  所有 NPC/势力 action 执行器经 `worldContext.rng` 取随机。
- 实体内部随机：经 `_entityConfig.rng` 注入每个 `NPCEntity`（`this._rng`），覆盖构造期（资质/寿元/执念 roll）
  与运行时（决策周期/突破/自然死亡）；`MonsterEntity` 经 `opts.rng` 注入，覆盖巡逻角度与全部 BT 运行时随机。
- `NPCState` / `MonsterState` 构造与 `checkNaturalDeath` 接收并持有 rng。
- 地图领地生成（`TerritoryLayoutGenerator`）与妖兽分布（`MonsterSpawner`）的种子与引擎主种子耦合，
  保证整局由单一 `seed` 复现。
- 接受 `randomFn` 的既有接口（`quest-rewards` / `monster-resources`）由调用方传入 `worldContext.rng.fn()`。

共替换 23 个文件中的全部模拟 `Math.random`（按用户要求一次性彻底替换）。

### 三、日志落盘（serve.py + 客户端）

浏览器不能写磁盘，故由静态服务器 `serve.py` 新增 POST 接口接收落盘：

- `POST /api/log`：把一批事件日志追加到 `runs/<runId>/log.jsonl`。
- `POST /api/replay`：把整份重放写到 `runs/<runId>/replay.json`。
- 安全：`runId` 经白名单正则校验，防路径穿越。

客户端新增 `apps/game/js/storage/replay-recorder.js`（`ReplayRecorder`）：持有 seed、按 tick 缓冲事件、
分批 POST 落盘；服务器不可用（如 `file://` 打开）时自动降级为内存记录，不影响游戏。

### 四、重放（seed + 输入序列，不用配置摘要）

`ReplayRecorder` 记录 `{ version, runId, seed, inputs:[{tick,type,payload}], totalTicks }`。
因为模拟已确定性，**重放 = 用相同 seed 重建引擎、按相同输入序列重新 tick**，结果必然一致，
**无需配置摘要比对**（按用户要求去除）。`GameManager` 暴露 `getSeed()` / `saveReplay()` / `restartWithSeed(seed)`，
并在 `init({ seed })` 注入种子；TICK/MULTI_TICK 在请求时登记输入，结果回来时登记事件日志。

## 验证

新增 `apps/game/tools/verify-determinism.mjs`（不再 monkeypatch `Math.random`）：

- 同 seed 跑两次：摘要一致 → **可复现**。
- 不同 seed：摘要不同 → **种子确实驱动随机**。

实测（120 天）：`seed=12345` 两次均为 `8cbf5559`；`seed=67890` 为 `e70d64bf`，两项均通过。
落盘逻辑（JSONL 追加、replay.json、路径穿越防护）经离线单测验证正确。

## 影响 / 后续

- 旧 `refactor-baseline.mjs` 的固化摘要基于 monkeypatch `Math.random`，本次改源后其旧摘要自然失效；
  应改用 `configs.seed` 重新固化基线（后续按需处理）。
- 为将来迁移 Unity 打基础：确定性模拟 + 输入序列重放是跨引擎对拍/迁移验证的前提。
- HTTP 落盘接口在受限沙箱环境可能无法回环连通，客户端已做内存降级，不阻塞游戏。

