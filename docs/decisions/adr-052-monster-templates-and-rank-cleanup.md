# ADR-052：妖兽属性模板与境界语义清理

> 最后更新：2026-06-06
> 状态：已采纳
> 关联：ADR-026、ADR-041、ADR-042、ADR-051
> 来源：`docs/superpowers/specs/2026-06-06-妖兽属性模板与境界清理-design.md`

## 背景

旧 `rankId` 同时承载修仙境界、凡人王朝头衔和武道头衔，导致血量、减伤、修炼、突破和战力公式读取到不同语义的数据。旧妖兽配置直接手填 `strength`、`speed`、`defense`、`sense`、`vitality`，难以表达体型、移动方式、战斗风格、属性、特殊血脉和习性差异。

## 决策

1. `rankId` 只表示修仙境界：`mortal`、`qi_refining`、`foundation_building`、`golden_core`、`nascent_soul`、`spirit_transformation`。
2. `disciple`、`general`、`officer`、`leader`、`elder`、`core_disciple`、`outer_disciple` 等只作为 `role` 或关系语义，不进入 `ranks.json`。
3. 初始运行时世界移除凡人王朝势力和王朝系 NPC。世俗动荡只作为世界事件、叙事素材或机会点来源，不作为可行动势力参与核心模拟。
4. 妖兽属性由阶位基准、体型、移动、战斗风格、属性、特殊类型和习性组成。元素属性模板不直接修改面板数值，只描述技能、材料、抗性和叙事倾向。
5. 妖兽气血、真元、攻击、防御、速度、神魂由 `monster-attribute-templates.json` 和 `monster-attributes.js` 统一计算。运行时入口不得各自维护另一套妖兽面板公式。
6. 妖兽技能使用 `skills[]`，每个技能必须声明 `type`。使用真元或持续消耗的技能必须声明 `cost`。

## 后果

- 境界公式、血量、减伤、突破和战力比较只面对修仙境界，不再为凡人头衔保留兜底分支。
- 新增妖兽时通过模板组合表达差异，校验工具能发现非法体型、特殊类型冲突、低阶技能过多、消耗缺失等问题。
- 小型飞行、虫群、幻术狐、玄龟、蛟龙、上古真龙等典型生态差异能由数据自然呈现。
- 妖兽面板数值显著抬升后，必须通过真实长程模拟观察斩妖任务、妖兽袭击、死亡掉落和材料经济闭环。

## 验证要求

- `test-rank-cleanup.mjs` 确认 `rankId` 只剩修仙境界，初始世界没有凡人王朝势力。
- `test-monster-attribute-templates.mjs` 覆盖模板计算、兼容镜像和非法模板错误。
- `test-monster-config-validation.mjs` 覆盖 36 只妖兽的模板合法性和典型生态差异。
- `test-monster-runtime-attributes.mjs` 覆盖运行时实体、HP、战力和斩妖战力入口。
- 长程模拟必须观察真实行为数据，不以摘要值代替行为正确性判断。
