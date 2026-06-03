# ADR-035：势力凝聚力与危亡抉择（多元危机反应 → 势力覆灭涌现）

最后更新：2026-06-01

状态：已实现（v5；势力危亡时成员按性格/利益做 7 类抉择，凝聚力涌现，势力覆灭 0→1 首次打通）

## 背景

ADR-034（人口可持续）的 v4 P1 实现了"势力覆灭动态阈值"，但**从未触发**：势力强度挂在抽象 `disciples` 数值上、被招募持续输血，攻战即使杀真实 NPC 也打不死势力。更深层的问题是——攻战时 NPC 完全**被动**：被随机处死、被动写记忆，没有任何人的选择。

但真实修仙世界里，势力危亡时人的反应丰富多样：不是所有人都有骨气死战。用户（2026-06-01）明确指出：NPC 会提前逃跑、会背叛宗门，这些由性格、利益、承诺决定；势力应有凝聚力差异，没凝聚力的很容易覆灭。

按项目规则，涉及世界观设定先查 `docs/世界观参考/`：凡人修仙传（谨慎退避、散修阵营切换、作鸟兽散、弱宗归顺）、仙逆（守护型舍命、算计型背叛）、大道争锋（被迫效忠精血誓言、弃徒转盟友、宗门吞并）的冲突分析共同支撑了一套**危亡反应谱系**。

## 决策

把"势力覆灭"从数值判断改造为**个体选择的涌现结果**：势力遭重创时，每个幸存成员按"性格 × 利益 × 关系 × 处境"在 7 类反应中做加权抉择。凝聚力低的势力大量叛投/出走/投降 → 真实人口骤降 → 触发 ADR-034 覆灭阈值而自然灭门。

### 一、危亡反应谱系（7 类，数据驱动）

死战 / 退避隐忍 / 叛投敌方 / 出走散修 / 被迫效忠 / 抢先逃命（6 类个体抉择）+ 投降归顺（1 类群体判定）。每类的触发倾向、后果与世界观来源见 `docs/worldbuilding/wiki/rules/faction-crisis-defection.md`。

### 二、凝聚力 = 涌现量，非硬编数值

势力不持有固定"凝聚力分数"。凝聚力是成员"选择死战/留下"比例的统计涌现：高忠诚/高勇气成员多 → 大多死战 → 难灭；一盘散沙 → 大量流失 → 易覆灭。这使"势力有的有凝聚力、有的没有、有的易覆灭"成为自然结果。

### 三、危机态触发用相对信号（关键修订）

初版用绝对稳定度阈值触发危机，但势力稳定度因自然恢复长期虚高（80~3000+，疑似独立历史 bug），阈值进不去——与 ADR-034 v4 P1 同一病根。修订为攻战当下可靠的**相对信号**：战力悬殊（`powerRatio ≥ crisisPowerRatio`）或防守方真实活 NPC 很少（`≤ crisisAliveNpcThreshold`）。修订后势力覆灭立即 0 → 1。

### 四、个体抉择算法

- `weight = base × Π(性格 trait 映射倍率)`：trait(0-100) 线性映射到配置的 `[lo, hi]` 倍率区间；`*Inv` 取 `100-trait`；`cautionExtreme` 用 `caution²` 放大尾部。
- 核心成员（领袖/继承人/长老/核心弟子）死战权重乘 `coreMult`，保护顶梁柱不轻易叛逃。
- 按权重随机抽取（保留随机性，避免完全确定化）。
- 后果：叛投/投降改 `factionId` 到攻方；出走/逃命转散修；被迫效忠扣 `morale`；流失人数同步扣减抽象 `disciples`，使凝聚力低的门派真实削弱。

## 设计模式映射

- **数据驱动 + 开闭原则**：7 类反应、权重系数、危机阈值、`enabled` 全部在 `combat.json → cohesion`，新增反应或调系数不改核心代码、可灰度回退。
- **策略**：抉择逻辑封装在 `FactionAIService` 的私有方法，作用于攻战结算这一处注入点。
- **涌现优于硬编**：凝聚力不建模为字段，而由个体决策统计涌现（符合项目"规则驱动、世界自演化"定位）。

## 数据与接口

- 改 `data/balance/combat.json`：新增 `cohesion`（含 `reactions` / `surrender` / `effects` / 危机阈值）。
- 改 `js/engine/world/services/faction-ai-service.js`：构造读取 cohesion；新增 `_trait` / `_traitFactor` / `_chooseCrisisReaction` / `_makeWanderer` / `_switchFaction` / `_resolveCrisisChoices`；攻战胜利结算处插入抉择。
- 新增设定 `docs/worldbuilding/wiki/rules/faction-crisis-defection.md`。
- 备份 `docs/balance/backup/pre-tuning-v5-combat.json` / `pre-tuning-v5-faction-ai-service.js`。
- 不改任何对外 API 签名；`cohesion.enabled=false` 时攻战完全退化为 v4 行为。

## 后果

- **势力覆灭首次打通**：5000 天定稿 0 → 1（万妖山因凝聚力不足覆灭），且仅 1 个、其余 17 个稳定——机制有差异性、不雪崩。
- 攻战从"被动随机处死"升级为"个体有选择的危亡叙事"（叛投/出走/投降/死守），更贴近修仙小说。
- power_struggle 死因 2 → 6，权力斗争升温；女/男比 0.70 为四轮最佳。
- 全程数据驱动可一键回退，GOAP 黄金指纹 `5740e12a` 零漂移。

## 验证

- 2000 天冒烟：修订危机判据后势力覆灭 0 → 1。
- 5000 天定稿（全激活态）：势力覆灭 1，末态存活 NPC 51，女/男 0.70，突破 94，power_struggle 死因 6。
- GOAP 黄金指纹 `5740e12a` 零漂移；回归测试通过（`test-goap-golden` / `test-revenge` / `test-relationship-goals` / `test-monster-resource-loop`）。
- 详见 `docs/balance/tuning-2026-06-01-v5-result.md`。

## 未解问题（v6）

- 势力稳定度量级异常（可达 3000+，应 0-100）——v5 用相对信号绕过，根因待查。
- 覆灭数偏少（仅 1）——可微调 cohesion 让中等凝聚力势力在持续挨打下也流失。
- 投降/叛投后攻方对降众的消化（同化/猜忌/反叛）叙事。
- 复仇 PvP 击杀仍低（与 ADR-034 同列）。

## 相关

- ADR-034（人口可持续，势力覆灭动态阈值的未解问题 —— 本 ADR 是其结构性后继）。
- ADR-033（自迭代优化流程）+ `docs/balance/simulation-iteration-process.md`。
- 设定 `docs/worldbuilding/wiki/rules/faction-crisis-defection.md`、`personality.md`。
- 世界观参考：凡人修仙传 / 仙逆 / 大道争锋《冲突事件分析》。
