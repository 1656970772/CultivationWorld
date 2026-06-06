# 妖兽属性模板系统

> 最后更新：2026-06-06
> 数据来源：`apps/game/data/definitions/monster-attribute-templates.json`、`apps/game/js/engine/monster/monster-attributes.js`

## 定位

妖兽属性模板系统把妖兽面板从手填数值迁移为“阶位基准 + 五层模板 + 少量微调”。数据作者通过模板描述妖兽生态差异，运行时由 `resolveMonsterAttributes()` 统一生成气血、真元、攻击、防御、速度和神魂。

`MonsterStaticData`、`MonsterState`、`MonsterSpawner` 和斩妖战力入口都读取统一结果，不再各自维护妖兽 HP、速度或战力公式。

## 阶位基准

`gradeBaselines` 按一至九阶提供基础面板：

| 字段 | 说明 |
|------|------|
| `hp` | 气血上限 |
| `attack` | 直接攻击能力 |
| `defense` | 直接防御与减伤能力 |
| `speed` | 地图移动和追逃基础速度 |
| `qi` | 真元池，供主动技能或持续技能消耗 |
| `spirit` | 神魂/神识强度，用于幻术、感知、控制等倾向 |

阶位基准只给同阶中型普通妖兽的默认水平，具体差异由模板组合表达。

## 五层模板

| 层级 | 字段 | 数值作用 |
|------|------|----------|
| 体型 | `templates.size` | 单选，影响 `hp`、`attack`、`defense`、`speed` |
| 移动方式 | `templates.movement[]` | 多选，主要影响 `attack`、`speed` |
| 战斗风格 | `templates.combatStyles[]` | 多选，影响 `attack`、`defense`、`qi`、`spirit` |
| 属性 | `templates.elements[]` | 多选，只描述元素、材料、抗性和叙事倾向，不直接改面板 |
| 特殊类型/习性 | `templates.specialTypes[]`、`templates.habits[]` | 特殊类型可整体放大面板；习性只给 AI 和叙事使用 |

元素模板不得直接修改面板属性。若某只妖兽确实需要突破模板结果，可使用 `attributeAdjustments` 做小范围修正，并在 `description` 或 `source` 中说明原因。

## 直接面板与兼容镜像

`attributes` 的主语义是直接面板：

| 字段 | 说明 |
|------|------|
| `attributes.hp` | 气血上限 |
| `attributes.qi` | 真元 |
| `attributes.attack` | 攻击 |
| `attributes.defense` | 防御 |
| `attributes.speed` | 速度 |
| `attributes.spirit` | 神魂 |

为兼容旧入口，计算器会同时派生镜像字段：

| 旧字段 | 当前含义 |
|--------|----------|
| `vitality` | 等同 `hp` |
| `strength` | 等同 `attack` |
| `sense` | 等同 `spirit` |

新数据和新逻辑应优先读取直接面板字段。

## 技能规则

`skills[]` 表示妖兽身法、主动能力和被动特性。

| 字段 | 规则 |
|------|------|
| `skills[].id` | 技能 ID，建议使用 `skill_<妖兽编号>_<类型>` |
| `skills[].name` | 中文显示名 |
| `skills[].type` | 必填，只能是 `movement`、`active`、`passive` |
| `skills[].description` | 描述技能效果、触发条件和生态表现 |
| `skills[].cost` | 使用真元或持续消耗的非被动技能必须声明 |
| `skills[].cost.mode` | 只能是 `perUse`、`perDay`、`continuous` |

低阶普通妖兽应保持技能数量克制；若需要多个技能，应通过特殊类型、来源描述或后续平衡验证说明理由。

## 校验与模拟

新增或调整妖兽后至少运行：

- `node tools/test-monster-attribute-templates.mjs`
- `node tools/test-monster-config-validation.mjs`
- `node tools/test-monster-runtime-attributes.mjs`

涉及面板倍率、斩妖任务或妖兽掉落闭环时，还需要运行真实长程模拟，观察低阶威胁、模板生态差异、斩妖任务是否绑定真实目标、妖兽死亡与材料产出是否继续闭环。
