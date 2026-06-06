# 数据模型：妖兽

> 最后更新：2026-06-06
> 数据来源：`apps/game/data/definitions/monsters.json`、`apps/game/data/definitions/monster-attribute-templates.json`

## 定位

`monsters.json` 定义运行时可生成、可战斗、可掉落材料的妖兽。当前共有 36 条定义，覆盖一至九阶。妖兽面板由 `monster-attribute-templates.json` 和 `monster-attributes.js` 统一计算，并在定义中保留生成后的 `attributes` 便于人工审阅和工具校验。

## 字段表

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | 妖兽定义 ID |
| `name` | string | 中文名 |
| `category` | string | 固定为 `monster` |
| `type` | string | 妖兽类型，如 `demon_beast`、`spirit_beast` |
| `family` | string | 族群，如 `canine`、`dragon`、`insect` |
| `grade` | number | 一至九阶 |
| `gradeName` | string | 中文阶位显示 |
| `equivalentRealm` | string | 叙事上的相当修士境界 |
| `habitat` | string[] | 可生成地形或生态位 |
| `templates.size` | string | 单一体型模板 |
| `templates.movement` | string[] | 移动模板 |
| `templates.combatStyles` | string[] | 战斗风格模板 |
| `templates.elements` | string[] | 属性模板 |
| `templates.specialTypes` | string[] | 特殊类型模板 |
| `templates.habits` | string[] | AI 习性标签 |
| `attributes.hp` | number | 直接气血上限 |
| `attributes.qi` | number | 真元 |
| `attributes.attack` | number | 攻击 |
| `attributes.defense` | number | 防御 |
| `attributes.speed` | number | 模板速度 |
| `attributes.spirit` | number | 神魂 |
| `attributes.vitality` | number | 兼容镜像，等同 `hp` |
| `attributes.strength` | number | 兼容镜像，等同 `attack` |
| `attributes.sense` | number | 兼容镜像，等同 `spirit` |
| `skills[]` | array | 身法/主动/被动技能 |
| `drops[]` | array | 死亡掉落材料与概率 |
| `rarity` | string | 稀有度 |
| `description` | string | 生态、战斗和材料说明 |
| `source` | string | 世界观或设计来源 |
| `canTransform` | boolean | 是否可化形 |
| `isAncient` | boolean | 是否上古血脉/古兽 |

## 约束

- 新妖兽必须声明五层模板和 typed `skills[]`。
- `templates.size` 必须是单个字符串；其他模板字段按数组处理。
- `templates.specialTypes` 中的 `normal` 不能和其他特殊类型并存。
- 元素和习性默认不直接修改面板，数值差异应优先由体型、移动、战斗风格和特殊类型表达。
- 运行时 HP、速度、战力和斩妖任务战力应通过 `resolveMonsterAttributes()` 取得统一面板。
