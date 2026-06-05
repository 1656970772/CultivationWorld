# 世界观设定

> 最后更新：2026-06-05

## 定位

本目录保存当前项目世界观框架。运行时事实以 `apps/game/data/` 为准；已敲定的规则、物品、关系、妖兽等细化设定沉淀到 `worldbuilding/wiki/`。

## 文档结构

```text
worldbuilding/
├── README.md
├── continent.md      # 300×300 玄天大陆分区和关键坐标
├── factions.md       # 12 个核心势力 + 6 个功能组织
├── npcs.md           # 关键首领和当前 NPC 规模
├── relations.md      # 12 个核心势力的初始关系矩阵
├── history.md        # 世界背景与纪元
└── wiki/             # 已敲定设定 Wiki
```

## 维护规则

- 当前数量、坐标、ID 必须以 `apps/game/data/` 为来源。
- 世界观推演如果变成机制规则，要同步写入 `wiki/` 对应条目。
- 若新增势力、NPC、妖兽、物品，应同步更新本目录导航和 `docs/README.md`。
- 原著参考材料仍存放在 `docs/世界观参考/`，涉及世界观设定时优先查阅。

## Wiki 入口

- `wiki/README.md`：已敲定设定导航。
- `wiki/wiki-template.md`：新增条目模板。
- `wiki/rules/`：规则类条目。
- `wiki/artifacts/`：功法、法宝、灵石等。
- `wiki/creatures/`：妖兽异兽体系。
- `wiki/characters/`：人物关系类型。
