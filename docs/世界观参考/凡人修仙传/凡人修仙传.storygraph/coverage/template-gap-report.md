# Stage 2 Template Gap Report

## NPC性格与代表事件

- {'gap_id': 'npc-profile-fields-incomplete', 'description': '多数角色缺少完整身份、境界、所属势力、活动地域、阶段状态闭合证据。', 'requirement_ids': ['character_relationship_perspective'], 'evidence_ids': [], 'status': 'open'}
- {'gap_id': 'loyal-guardian-case-insufficient', 'description': '忠诚守护型完整案例不足，当前只可写燕歌服从严氏、孙二狗投靠韩立等局部行为。', 'requirement_ids': ['character_relationship_perspective'], 'evidence_ids': ['evidence:chunk-0118:002', 'evidence:chunk-0123:003'], 'status': 'needs_more_evidence'}
- {'gap_id': 'viewpoint-causal-boundary', 'description': '涉及动机成因的条目需保留视角边界，例如厉飞雨名利心可能与抽髓丸有关仅是韩立观察推测。', 'requirement_ids': ['character_relationship_perspective'], 'evidence_ids': ['evidence:chunk-0041:004'], 'status': 'needs_review'}
- 多数 NPC 的境界、完整所属势力、活动地域和阶段状态未在本批目标证据中同时闭合；未用模板示例补齐。
- 完整的性格变化前后链条只在少数角色上可见；小算盘、墨彩环、燕歌等更多是单场景行为证据，不能扩展为全生命周期性格结论。
- 忠诚守护型角色的高置信完整案例不足；燕歌对严氏服从、孙二狗投靠韩立只能支撑局部关系或服从行为，不能直接等同忠诚守护。

## 世界状态与灾变

- {'requirement_id': 'world_region_state_place', 'status': 'partial', 'evidence_ids': [], 'notes': ['模板示例中的魔气上涨、灵脉枯竭、兽潮三类未在当前证据中闭合。', '部分灾变缺少恢复/消退后续结果。']}
- 未找到“魔气上涨导致区域污染与修士迁徙”的可靠证据；当前可用的是魔道入侵、战争扩散和宗门撤离，不应替换为魔气污染设定。
- 未找到“灵脉枯竭引发宗门资源压力”的可靠证据；黄枫谷撤离源于前线大败和灭门危机，而非灵脉枯竭。
- 未找到“兽潮爆发改变边境区域状态”的完整证据链；七星海“妖兽”只作为三大天灾之一被点名，缺少兽潮起点、范围、扩散和结果。
- 多数灾变条目缺少精确恢复/消退结果，例如越国战局后续恢复、天风灾后重建、鬼雾消散机制、虚天殿禁制解除后果等。

## 世界观设定

- {'requirement_id': 'world_region_state_place', 'status': 'partial_pending', 'content': '完整跨界地图、灵界/仙界/大晋区域风貌、精确距离链和人口建筑量化数据缺少可靠证据。', 'evidence_ids': []}
- 未在本 task packet 和已筛选的 `supports_templates[].template_name == 世界观设定` 证据中找到可用于生成灵界、仙界区域风貌的可靠条目。
- 未见可闭合的大晋区域风貌证据；不应仅凭作品常识补写大晋地理、城市或宗门分布。
- 多数区域缺少精确距离、完整道路网络、人口规模、建筑尺寸和物价变化证据；这些字段应保留为空或待核验。

## 丹药分析

- {'requirement_id': 'complete_formula', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['多种丹药仅给出功效或少量材料，完整配方不可补造。']}
- {'requirement_id': 'pill_grade_and_price', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['仅定颜丹交易、筑基丹分配/稀缺、古方购买等少数经济线索可证。']}
- {'requirement_id': '炼气散抗药性机制', 'status': 'needs_review', 'evidence_ids': ['evidence:chunk-0247:011'], 'notes': ['角色推测，非旁白确认。']}
- 多数丹药未见完整配方或材料清单：黄龙丹、金髓丸、清灵散、养精丹、降尘丹、饲灵丸等仅有用途或部分材料线索，不应补造完整丹方。
- 多数丹药未见明确品阶、标准售价、炼制成功率或普适副作用；只有筑基丹稀缺产量、血凝五行丹煞丹三分之一机会、结丹灵物成功率边界等少数项有明确证据。

## 事件因果链（长程因果图）

- {'content': '虚天殿链中“正魔双方疑似争夺虚天鼎”的具体阵营边界和每方最终收益仍需后续章节证据复核；当前只确认多方围绕取鼎条件、韩立和血玉蜘蛛展开争夺。', 'category': '待核验', 'confidence': 'AMBIGUOUS'}
- {'content': '魔道入侵链中的具体战损人数、资源消耗清单和每个宗门的独立战略目标未在当前证据中闭合，应保留为待核验。', 'category': '待核验', 'confidence': 'AMBIGUOUS'}
- {'content': '墨大夫遗书后的妻小安置如何继续影响韩立后续路线，当前仅能确认遗书任务本身，长程偿付关系需在后续证据中继续追踪。', 'category': '待核验', 'confidence': 'AMBIGUOUS'}
- {'content': '未见可靠证据支持把所有时间相邻事件自动判定为因果；本记录只把有动机、行动、结果或后果证据闭合的节点写入因果链。', 'category': '未见可靠证据', 'confidence': 'AMBIGUOUS'}
- {'content': '未见当前证据给出七鬼噬魂大法、阴火大阵、虚天殿禁制等机制的完整数值化消耗或伤亡统计。', 'category': '未见可靠证据', 'confidence': 'AMBIGUOUS'}
- {'content': '未见当前证据完整覆盖虚天鼎争夺的最终归属、所有参与者收益分配和全部失败路径。', 'category': '未见可靠证据', 'confidence': 'AMBIGUOUS'}
- 未见可靠证据支持把所有时间相邻事件自动判定为因果；本记录只把有动机、行动、结果或后果证据闭合的节点写入因果链。
- 未见当前证据给出七鬼噬魂大法、阴火大阵、虚天殿禁制等机制的完整数值化消耗或伤亡统计。
- 未见当前证据完整覆盖虚天鼎争夺的最终归属、所有参与者收益分配和全部失败路径。

## 人物关系与事件分析

- {'requirement_id': 'character_relationship_perspective', 'status': 'needs_review', 'content': '张铁被害执行过程、南宫婉双向态度、元瑶隐情和妙音门长期履约仍需后续证据补足。', 'evidence_ids': ['evidence:chunk-0066:002', 'evidence:chunk-0215:007', 'evidence:chunk-0452:002', 'evidence:chunk-0416:003']}
- 未在所选可靠证据中确认韩立与南宫婉在该阶段存在公开婚约、正式道侣身份或双向长期承诺。
- 未在所选可靠证据中确认墨大夫最初收韩立为徒时公开说明夺舍目的；早期只能写表面教学与后续揭露。
- 未在所选可靠证据中确认张铁被劫持时的完整现场经过、张铁本人最后意识或墨大夫直接供认。
- 未在所选可靠证据中确认韩立成为妙音门实权长老；证据仅支持名义长老、待遇与借名自保。

## 信息传播与情报

- {'content': '七玄门低语链中，原文只给出断续词语和韩立判断；“名单”的具体内容、偷取对象、执行者完整身份仍需后续证据复核。', 'category': '待核验', 'confidence': 'AMBIGUOUS', 'evidence_ids': ['evidence:chunk-0040:008', 'evidence:chunk-0040:012', 'evidence:chunk-0040:015'], 'requirement_ids': ['world_region_state_place']}
- {'content': '关于董姓少女的流言，师娘明确说没有实凭实据且讲述者自己也未必知道真假；只能作为“流言传播与真假不明”的案例，不能写成客观经历。', 'category': '待核验', 'confidence': 'AMBIGUOUS', 'evidence_ids': ['evidence:chunk-0249:001', 'evidence:chunk-0249:003'], 'requirement_ids': ['world_region_state_place']}
- {'content': '虚天殿残图“别人孝敬给蛮胡子”的上游来源、残图复制数量和各方取得路径未在当前证据中闭合。', 'category': '待核验', 'confidence': 'AMBIGUOUS', 'evidence_ids': ['evidence:chunk-0437:010'], 'requirement_ids': ['world_region_state_place']}
- {'content': '黄枫谷前方只传来输送灵石物资要求且无不利消息，可作为信息封锁或前线失真疑点；但当前证据不能确认是谁故意封锁或篡改消息。', 'category': '待核验', 'confidence': 'AMBIGUOUS', 'evidence_ids': ['evidence:chunk-0349:015'], 'requirement_ids': ['world_region_state_place']}
- {'content': '未见可靠证据给出乱星海通缉令原文、悬赏金额、张贴渠道或悬赏执行流程；现有证据只支持“被通缉/被追查导致韩立离开西南海域”。', 'category': '未见可靠证据', 'confidence': 'AMBIGUOUS', 'evidence_ids': [], 'requirement_ids': ['world_region_state_place']}
- {'content': '未见可靠证据说明血色试炼禁地封闭公告如何传播到七派之外的散修或坊市；当前只覆盖黄枫谷上层公告、信符催集和七大派现场开启规则。', 'category': '未见可靠证据', 'confidence': 'AMBIGUOUS', 'evidence_ids': [], 'requirement_ids': ['world_region_state_place']}
- {'content': '未见可靠证据证明韩立与钟吾交换的中心区资料具体遗漏了哪些关键处；只能确认双方心照不宣存在遗漏可能。', 'category': '未见可靠证据', 'confidence': 'AMBIGUOUS', 'evidence_ids': [], 'requirement_ids': ['world_region_state_place']}
- {'content': '未见可靠证据完整列出虚天殿残图的全部流转链、各方获图时间和残图真伪验证方式。', 'category': '未见可靠证据', 'confidence': 'AMBIGUOUS', 'evidence_ids': [], 'requirement_ids': ['world_region_state_place']}
- 未见可靠证据给出乱星海通缉令原文、悬赏金额、张贴渠道或悬赏执行流程；现有证据只支持“被通缉/被追查导致韩立离开西南海域”。
- 未见可靠证据说明血色试炼禁地封闭公告如何传播到七派之外的散修或坊市；当前只覆盖黄枫谷上层公告、信符催集和七大派现场开启规则。
- 未见可靠证据证明韩立与钟吾交换的中心区资料具体遗漏了哪些关键处；只能确认双方心照不宣存在遗漏可能。
- 未见可靠证据完整列出虚天殿残图的全部流转链、各方获图时间和残图真伪验证方式。

## 修炼流派

- {'requirement_id': 'cultivation_system_method_progression', 'status': 'partial', 'evidence_ids': [], 'notes': ['模板示例覆盖范围大于当前 supports_templates == 修炼流派 证据范围；已避免无证补齐。']}
- 未在本批直连证据中找到足够材料，把“宗门权力流”“复仇执念流”“守护亲友/重情义流”分别写成完整修炼流派案例。
- 多数功法缺少完整配方、逐层突破资源、失败后果和全部神通清单；未闭合处保留为证据缺口。

## 冲突事件分析

- {'requirement_id': 'event_conflict_combat_opportunity', 'status': 'needs_review', 'description': '模板示例中的风雷翅链条未在本批优先证据中命中，建议后续按章节或关键词做增量证据补采。', 'evidence_ids': []}
- 本批 evidence-index 中未找到 support template 为“冲突事件分析”且明确提到“风雷翅”的证据；不得据模板示例补写该完整事件链。

## 功法术法神通

- {'requirement_id': 'complete_formula_and_success_rate', 'status': 'not_found_in_source', 'notes': ['多数功法/术法没有完整口诀、逐层资源表或成功率证据。'], 'evidence_ids': []}
- {'requirement_id': 'unverified_mechanism_links', 'status': 'needs_review', 'notes': ['元磁神光克五行、玄阴经与血炼神光同源、长春功灵根要求需与后续正式设定复核。'], 'evidence_ids': ['evidence:chunk-0414:003', 'evidence:chunk-0387:005', 'evidence:chunk-0032:008']}
- 当前支撑证据未提供多数功法、术法的完整口诀原文、逐层修炼表、通用成功率或统一资源清单；这些字段不应由修仙常识补齐。
- 未在本次精选证据中确认独立“御兽诀”卡片；可写入傀儡术、大衍诀，但不要把御兽、傀儡、驱物混写为同一流派。

## 动态事件与机会点

- {'requirement_id': 'event_conflict_combat_opportunity.evidence.04.mark_not_found_when_missing', 'status': 'partial', 'content': '拍卖会准备-竞价-截杀链条未在本模板支撑证据中闭合。', 'evidence_ids': ['evidence:chunk-0428:007']}
- {'requirement_id': 'event_conflict_combat_opportunity.evidence.02.conflict_requires_result', 'status': 'partial', 'content': '部分战斗只可支撑风险升级和消耗，不足以支撑完整招式、伤亡数量与战利品明细。', 'evidence_ids': ['evidence:chunk-0187:009', 'evidence:chunk-0207:015']}
- 模板示例中的“拍卖会引发准备、竞价和截杀”在本模板支撑证据中只见七霞莲采摘后拍卖平分灵石的片段，未见完整竞价、截杀与后续追索链条，因此不作为完整案例写入 facts。
- 血色禁地条目有杀人夺宝和妖兽消耗证据，但本记录未抽取到每一场具体战斗的完整招式、伤亡数量和战利品清单；这些细项应保持缺口，不用推断补齐。

## 势力设定

- {'requirement_id': 'faction_society_economy_task', 'status': 'needs_review', 'content': '价格、产能、全量职级权限和完整商盟名单存在证据缺口，已在待核验与未见可靠证据中标注。', 'evidence_ids': ['evidence:chunk-0149:010', 'evidence:chunk-0165:002', 'evidence:chunk-0396:002', 'evidence:chunk-0415:006']}
- 未见可量化支撑七玄门财政收入、弟子俸禄标准、各城镇税收或资源产能的可靠证据。
- 未见可完整列出乱星海四大商盟全部成员、各自业务范围和势力等级的可靠证据。
- 未见可完整说明散修晋升为宗门正式弟子的统一制度；当前只有个案路径与会议/居留规则。

## 境界提升与功法分析

- {'requirement_id': 'template_case_3_jiedan_to_yuanying', 'status': 'partial', 'description': '缺少完整结丹到元婴冲关案例。', 'evidence_ids': ['evidence:chunk-0130:004', 'evidence:chunk-0237:001', 'evidence:chunk-0461:006', 'evidence:chunk-0464:022']}
- {'requirement_id': 'template_case_4_yaoshou_huaxing', 'status': 'not_found_in_source', 'description': '缺少妖兽自身化形或升阶流程闭合证据。', 'evidence_ids': []}
- 未在本模板直连证据中找到妖兽自身从某阶突破到更高阶或化形成人的完整机制；当前只能写妖兽阶位、战力和内丹资源，不应补造化形流程。
- 未找到结丹期修士实际成功凝结元婴的完整案例；现有材料只支持元婴目标、传闻资源和元神能力差异。

## 夺舍设定分析

- {'template_name': '夺舍设定分析', 'requirement_id': 'cultivation_system_method_progression', 'status': 'not_found_in_source', 'item': '血脉重塑明确流程', 'evidence_ids': [], 'notes': ['当前证据组没有可闭合案例。']}
- {'template_name': '夺舍设定分析', 'requirement_id': 'cultivation_system_method_progression', 'status': 'needs_review', 'item': '转世/重生/复活与玄魂之体边界', 'evidence_ids': ['evidence:chunk-0433:005', 'evidence:chunk-0433:006'], 'notes': ['可写为舍弃轮回与玄魂状态，不宜直接归为重生成功。']}
- 当前筛选证据未支持明确“血脉重塑”案例；不要以灵根躯壳需求替代血脉重塑。
- 当前筛选证据未支持完整“借尸还魂”流程；曲魂分身与玄魂附体可作为身体接管案例，但不是尸体复活流程。

## 妖兽与修士关系分析

- {'requirement_id': 'creature_deviant_practice_ecology.evidence.2', 'status': 'needs_review', 'content': '部分案例的契约规则、控制时限、失控前因和长期后果只有局部证据，已在 pending_verifications 中标注。', 'evidence_ids': ['evidence:chunk-0346:013', 'evidence:chunk-0469:012', 'evidence:chunk-0470:002']}
- {'requirement_id': 'creature_deviant_practice_ecology.template.example_missing', 'status': 'not_found_in_source', 'content': '本批优先证据未发现可闭合的兽潮、护山兽和妖族势力战争案例。', 'evidence_ids': []}
- 本批优先证据中未形成可闭合的“兽潮 / 护山兽 / 妖族势力与人族战争”完整案例；当前 record 不以模板示例补造这些关系。
- 双首鹜、云翅鸟、双瞳鼠等案例未见完整契约文本、繁育制度、等阶晋升规则或长期忠诚机制，相关字段保留为原文未说明。

## 妖兽分析

- {'requirement_id': 'true_spirit_or_divine_beast_case', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['本批直接证据未闭合真灵/神兽/上古异兽正式案例。']}
- {'requirement_id': 'complete_beast_rules', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['多数妖兽的繁殖、化形、弱点、掉落率和契约规则缺证，不可补写。']}
- {'requirement_id': 'black_scale_python_vs_mo_jiao', 'status': 'needs_review', 'evidence_ids': ['evidence:chunk-0208:017', 'evidence:chunk-0209:006', 'evidence:chunk-0209:007'], 'notes': ['黑麟蟒与墨蛟存在现场误认，正式正文需保留边界。']}
- 未在本批直接证据中见到可完整闭合的真灵、神兽或上古异兽正式案例；噬金虫有上古假死设定，但仍是奇虫案例，不应扩写成真灵/神兽。
- 多数妖兽未给出系统化繁殖条件、完整化形规则、弱点清单、掉落率或成套驯养契约条款；除证据明说内容外均应写“原文未说明”。

## 宗门任务体系

- {'requirement_id': 'faction_society_economy_task.evidence.02.task_system_closure', 'status': 'partial', 'content': '部分任务案例的准入条件、失败追责、奖励来源和行政流程只有间接或缺失证据；已在正文和待核验中标注原文未说明。', 'evidence_ids': ['evidence:chunk-0149:010', 'evidence:chunk-0153:002', 'evidence:chunk-0275:009', 'evidence:chunk-0385:004']}
- 未见可靠证据表明这些宗门任务使用类似大型网游的公开任务面板、统一贡献点商城或可自由刷新的任务清单；现有样本主要是管事分配、长老命令、制度考核和临时征调。
- 多数案例未见完整的任务殿账册、贡献点公式、失败赔偿数额、护送路线文书、阵法维护清单等行政细节；正文中均保留“原文未说明”。

## 建筑设施与场所功能

- {'requirement_id': 'world_region_state_place', 'status': 'partial', 'content': '检测设施和长期公共镇压设施样本不足，需后续按“测灵/问心/镇魔/镇魂/隔离阵”等关键词增量复核。', 'evidence_ids': []}
- 未在本轮优先证据中发现明确名为测灵台、测灵石、问心设施或血脉照验台的公共检测设施。
- 未在本轮优先证据中发现镇魔塔、镇魂碑、封印井、灾害隔离阵等长期公共镇压设施；现有明确封印样本是封灵柱，另有落日峰机关陷阱作为相邻样本。

## 战斗与保命机制

- {'template_name': '战斗与保命机制', 'requirement_id': 'event_conflict_combat_opportunity', 'status': 'needs_review', 'evidence_ids': [], 'notes': ['本次记录覆盖战斗行动链、损耗、夺宝和保命代价，但尚未系统覆盖全书所有境界、妖兽、元婴/残魂逃逸与传送保命样本。']}
- 所选证据未给出古长老战后韩立具体疗伤时间、法力余量或后续修复法器过程；只可确定其损失多件法器并夺得储物袋、黄色钵形法宝后离开。
- 所选证据未说明韩立舍弃颠倒五行阵后的重建成本、灵石消耗或修复时间。

## 拍卖坊市与交易

- {'requirement_id': 'faction_society_economy_task', 'status': 'needs_review', 'content': '黑市交易仅有“秘店”与匿名竞卖等近似证据，未见原文直接命名为黑市。', 'evidence_ids': ['evidence:chunk-0227:002', 'evidence:chunk-0227:012', 'evidence:chunk-0227:013']}
- 当前筛选证据未见直接以“黑市”命名的交易场景；可用“秘店”作为隐秘/灰色交易案例，但不应改写为原文明确黑市。
- 未见可稳定抽取的统一物价表；价格只能按具体证据记录，如飞天符三十块低阶灵石、基础功法两块低阶灵石、丰乐拍卖行溢价等单点事实。

## 散修生存方式

- {'template_name': '散修生存方式', 'requirement_id': 'faction_society_economy_task', 'status': 'partial_gap', 'gap': '未见明确挖矿型散修案例；老散修身份有一条为角色视角判断，需在正式文档中保守表述。', 'evidence_ids': ['evidence:chunk-0298:002']}
- 本批直接支持“散修生存方式”的证据中未见明确“挖矿型散修”完整案例；可保留为模板缺口，不应用海猿猎妖或灵药情报硬替。

## 有限视角与叙事日志

- {'template_name': '有限视角与叙事日志', 'requirement_id': 'character_relationship_perspective', 'status': 'partial', 'evidence_ids': [], 'notes': ['命灯/魂牌、商会消息、拍卖预告在本批优先证据中未形成可直接引用案例。']}
- 本批优先证据未见可直接支撑“命灯 / 魂牌”作为制度化生死状态反馈的片段；张铁案例只能作为现场痕迹推断与后续叙事确认，不等同命灯或魂牌机制。
- 本批优先证据未见明确的商会消息或拍卖预告案例；已有“坊市”相关证据是韩立隐瞒天星宗坊市经历，而非商会或拍卖文本。

## 材料分析

- {'requirement_id': '材料稀有度数值体系', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['原文多为罕见、世间少有、常见中阶等自然语言描述，未给统一量化等级。']}
- {'requirement_id': '完整材料产量与价格', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['仅少数场景给出交易数量或价值比较，不能推导全局价格表。']}
- 多数材料未见明确数值化等级、标准价格或完整产地坐标；除灵石等少数资源外，不应补造统一稀有度表或价格体系。
- 许多炼丹、炼器、制符材料只出现为配方或交易清单的一部分，未见完整采集流程、稳定产量或失败率。

## 武器分析

- {'requirement_id': 'resource_item_craft_profession', 'status': 'needs_review', 'content': '多件武器存在来源、材料、炼制流程、品阶或副作用缺口，未进入确认事实。', 'evidence_ids': ['evidence:chunk-0034:003', 'evidence:chunk-0054:006', 'evidence:chunk-0211:014', 'evidence:chunk-0332:004']}
- 未见可靠证据可列出所有武器的完整品阶、价格、炼制者、材料清单和成功率。
- 未见可靠证据说明暗青子毒药成分、连弩具体规格、绿煌剑炼制来源和风雷扇完整攻击机制。
- 未见可靠证据允许把“剑修之术”“巨剑门制式巨剑”等全部扩写为完整武器体系。

## 法宝分析

- {'template_name': '法宝分析', 'requirement_id': 'resource_item_craft_profession', 'status': 'partial_broad_coverage', 'evidence_ids': ['evidence:chunk-0245:014', 'evidence:chunk-0245:015', 'evidence:chunk-0245:016', 'evidence:chunk-0245:017', 'evidence:chunk-0403:020', 'evidence:chunk-0232:010', 'evidence:chunk-0232:011', 'evidence:chunk-0232:012', 'evidence:chunk-0233:001', 'evidence:chunk-0234:021', 'evidence:chunk-0166:001', 'evidence:chunk-0166:002', 'evidence:chunk-0166:014', 'evidence:chunk-0187:004', 'evidence:chunk-0188:005', 'evidence:chunk-0166:004', 'evidence:chunk-0166:005', 'evidence:chunk-0166:006', 'evidence:chunk-0166:007', 'evidence:chunk-0170:018', 'evidence:chunk-0170:008', 'evidence:chunk-0170:009', 'evidence:chunk-0171:005', 'evidence:chunk-0171:006', 'evidence:chunk-0171:012', 'evidence:chunk-0167:007', 'evidence:chunk-0167:008', 'evidence:chunk-0168:001', 'evidence:chunk-0188:013', 'evidence:chunk-0188:014', 'evidence:chunk-0188:015', 'evidence:chunk-0198:007', 'evidence:chunk-0198:008', 'evidence:chunk-0199:010', 'evidence:chunk-0199:011', 'evidence:chunk-0199:012', 'evidence:chunk-0064:004', 'evidence:chunk-0064:009', 'evidence:chunk-0107:009', 'evidence:chunk-0108:012', 'evidence:chunk-0110:011', 'evidence:chunk-0065:003', 'evidence:chunk-0065:004', 'evidence:chunk-0065:005', 'evidence:chunk-0077:005', 'evidence:chunk-0123:006', 'evidence:chunk-0440:003', 'evidence:chunk-0440:007', 'evidence:chunk-0460:006', 'evidence:chunk-0460:009', 'evidence:chunk-0234:006', 'evidence:chunk-0234:013', 'evidence:chunk-0234:018', 'evidence:chunk-0234:019', 'evidence:chunk-0274:001'], 'notes': ['本记录覆盖代表性高证据条目；图谱中仍有更多候选法器、符箓、材料和别名待后续全量去重。']}
- 多数非炼制类或传承类宝物的具体炼制材料、炼制者、认主方式、使用次数和副作用未在所引证据中说明，记录中保守写为“原文未说明”。
- 本批次证据未提供完整境界梯度、法宝品阶数值体系或每件法宝的精确价格，不进行补造。

## 灵根体质血脉

- {'template_name': '灵根体质血脉', 'requirement_id': 'cultivation_system_method_progression', 'status': 'not_found_in_source', 'content': '真灵血脉、神兽血脉、古族/王族/魔族血脉、妖族/灵族/异族天赋在当前目标模板证据中未见可靠案例。', 'evidence_ids': [], 'notes': ['王家直系血脉与灵根血脉继承可作为家族血脉案例，但不能扩写为高阶真灵/神兽/魔族血脉。']}
- 当前目标模板命中证据中未见可作为真灵血脉、神兽血脉、返祖血脉或高阶妖族血脉的可靠案例。
- 当前目标模板命中证据中未见妖族、灵族、异族等种族天赋的稳定案例；不应凭模板参考范围补写。

## 炼丹师

- {'template_name': '炼丹师', 'requirement_id': '炼丹师模板:符文/阵纹/禁制的使用', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['本批直接支持炼丹师的证据未出现符文、阵纹或禁制参与炼丹流程。']}
- {'template_name': '炼丹师', 'requirement_id': '炼丹师模板:时间成本', 'status': 'partial', 'evidence_ids': ['evidence:chunk-0219:009'], 'notes': ['有韩立近半年不间断炼制同种丹药的时间证据，但缺少单炉耗时、温养和保存时长。']}
- 本批证据未见炼丹流程中符文、丹纹、阵纹或禁制参与投药、封药、锁灵、稳定药力的明确描写。
- 本批证据未见系统化炼丹师等级表、学徒晋升规则、宗门供奉待遇、代炼抽成比例或坊市职业收费标准。
- 本批证据未见炸炉、丹炉损坏、丹毒反噬、异象暴露、药气外泄等失败后果；明确出现的是凝丹失败、废丹、材料消耗和经验成本。
- 本批证据未见单炉炼制的精确耗时、温养时长、冷却保存步骤、丹药品相等级或丹纹品质差异。

## 炼器师

- {'template_name': '炼器师', 'requirement_id': 'resource_item_craft_profession', 'status': 'needs_review', 'evidence_ids': ['evidence:chunk-0228:005'], 'notes': ['红罗天炉加成说法真伪不明。']}
- {'template_name': '炼器师', 'requirement_id': 'resource_item_craft_profession', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['未见完整器方、徐家妖火技巧细则、青竹蜂云剑全部辅助材料清单。']}
- 未见可靠证据给出《云霄心得》内部具体炼器步骤、完整器方目录或神兵门密法条文。
- 未见可靠证据给出青竹蜂云剑全部辅助珍稀材料的清单；证据只说明需要辅助材料并在剑胚阶段逐样加入。
- 未见可靠证据给出徐家妖火炼器技巧的具体操作法门，只能确认其被称为旁门火法且需特别技巧。

## 物资产出与消耗

- {'requirement_id': '物资产出与消耗.价格产能精确量化', 'status': 'needs_review', 'evidence_ids': ['evidence:chunk-0153:001', 'evidence:chunk-0402:012'], 'notes': ['上交数量、商家收购价格、单次产能和损耗率多处只有间接或局部证据。']}
- 未见可靠证据支持把黄枫谷资源体系写成统一贡献点商城；现有证据是灵石、灵药贡品、筑基丹奖赏、杂务上交和师徒抽成等分散制度。
- 未见当前证据给出灵石矿脉开采、宗门铸币或灵石自然生成机制；灵石在本记录中只能作为交易、费用、能源和补偿物处理。

## 相遇剧情与对话设计

- {'requirement_id': 'character_relationship_perspective', 'status': 'needs_review', 'evidence_ids': ['evidence:chunk-0133:001', 'evidence:chunk-0138:016'], 'notes': ['临时组队案例目前主要来自太南小会散修结伴；血色禁地分赃谈判未在本轮代表证据中闭合。']}
- {'requirement_id': 'character_relationship_perspective', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['完整逐字对白、所有参与者境界与年龄未在所选证据中全部出现。']}
- 所选证据未提供各场对话的完整逐字台词转录，只提供了关键摘录和事实摘要；正式模板若要求逐句对白，需要回读原文 chunk 扩充。
- 所选证据未明确给出所有参与者的境界、具体年龄或完整所属势力，不应为案例补写这些字段。

## 秘境遗迹与机缘

- {'template_name': '秘境遗迹与机缘', 'requirement_id': 'world_region_state_place', 'status': 'partial_broad_coverage', 'evidence_ids': ['evidence:chunk-0012:011', 'evidence:chunk-0012:012', 'evidence:chunk-0012:013', 'evidence:chunk-0012:014', 'evidence:chunk-0012:015', 'evidence:chunk-0163:003', 'evidence:chunk-0163:004', 'evidence:chunk-0176:010', 'evidence:chunk-0176:011', 'evidence:chunk-0184:002', 'evidence:chunk-0184:003', 'evidence:chunk-0185:005', 'evidence:chunk-0185:009', 'evidence:chunk-0186:010', 'evidence:chunk-0196:003', 'evidence:chunk-0198:001', 'evidence:chunk-0198:011', 'evidence:chunk-0204:003', 'evidence:chunk-0204:007', 'evidence:chunk-0272:012', 'evidence:chunk-0272:013', 'evidence:chunk-0274:020', 'evidence:chunk-0274:021', 'evidence:chunk-0275:003', 'evidence:chunk-0275:004', 'evidence:chunk-0275:007', 'evidence:chunk-0278:016', 'evidence:chunk-0278:017', 'evidence:chunk-0420:012', 'evidence:chunk-0420:013', 'evidence:chunk-0420:014', 'evidence:chunk-0420:015', 'evidence:chunk-0421:0008', 'evidence:chunk-0421:0009', 'evidence:chunk-0427:018', 'evidence:chunk-0427:020', 'evidence:chunk-0427:021', 'evidence:chunk-0427:022', 'evidence:chunk-0427:023', 'evidence:chunk-0427:024', 'evidence:chunk-0427:025', 'evidence:chunk-0427:026', 'evidence:chunk-0427:027', 'evidence:chunk-0428:023', 'evidence:chunk-0428:024', 'evidence:chunk-0428:025', 'evidence:chunk-0428:026', 'evidence:chunk-0428:027', 'evidence:chunk-0429:021', 'evidence:chunk-0429:022', 'evidence:chunk-0436:008', 'evidence:chunk-0436:009', 'evidence:chunk-0436:011', 'evidence:chunk-0436:012', 'evidence:chunk-0436:013', 'evidence:chunk-0436:014', 'evidence:chunk-0436:015', 'evidence:chunk-0436:016', 'evidence:chunk-0436:017', 'evidence:chunk-0436:018', 'evidence:chunk-0436:019', 'evidence:chunk-0436:020', 'evidence:chunk-0436:021', 'evidence:chunk-0436:022', 'evidence:chunk-0436:023', 'evidence:chunk-0436:024', 'evidence:chunk-0437:004', 'evidence:chunk-0438:001', 'evidence:chunk-0438:011', 'evidence:chunk-0439:011', 'evidence:chunk-0439:012', 'evidence:chunk-0439:013', 'evidence:chunk-0441:004', 'evidence:chunk-0441:005', 'evidence:chunk-0441:006', 'evidence:chunk-0441:007', 'evidence:chunk-0444:007', 'evidence:chunk-0444:008', 'evidence:chunk-0444:009', 'evidence:chunk-0442:006', 'evidence:chunk-0442:007', 'evidence:chunk-0442:008', 'evidence:chunk-0442:009', 'evidence:chunk-0442:010', 'evidence:chunk-0443:002', 'evidence:chunk-0443:008', 'evidence:chunk-0443:010', 'evidence:chunk-0450:015', 'evidence:chunk-0450:016', 'evidence:chunk-0450:017', 'evidence:chunk-0451:005', 'evidence:chunk-0451:006', 'evidence:chunk-0451:014'], 'notes': ['本记录覆盖代表性高证据秘境/遗迹/机缘；图谱中仍有更多秘境支撑节点，后续可按“坠魔谷、阴冥之地、灵缈园”等关键词增量扩展。']}
- 本批证据未给出血色禁地每次进入人数、完整名额分配和所有出口关闭细节。
- 荒岛土山古修士洞府的原主人身份、完整洞府布局和陷阱布置者身份，在本批证据中未见可靠闭合。
- 虚天殿关闭方式、内殿全部宝物清单和三大试炼全流程不在本批证据范围内。

## 符师

- {'requirement_id': '符师.template_headings.符方/符文传承来源', 'status': 'partial', 'evidence_ids': ['evidence:chunk-0141:008', 'evidence:chunk-0398:015'], 'notes': ['只见符术说明、基础咒书和星宫制符师，缺少完整符方/传承链。']}
- {'requirement_id': '符师.template_headings.制符环境', 'status': 'partial', 'evidence_ids': ['evidence:chunk-0141:002', 'evidence:chunk-0246:018'], 'notes': ['可见屋内桌面制符与洞府闭关练符，但没有专门制符室制度。']}
- 未见可靠证据给出通用“符方”清单或完整符文配方；现有证据只支持定神术制符方法、材料门槛和若干具体符箓案例。
- 未见原文给出制符师正式等级评定制度；只能从初级下阶、初级高阶、中级符箓、结丹期可制中级符箓等案例推断作品层级。
- 未见韩立加入专门符师门派或拜制符师为师；苦桑大师是规则解释者，不能据此写成韩立的制符师师承。

## 角色AI行为参考

- {'requirement_id': 'character_relationship_perspective', 'status': 'needs_review', 'evidence_ids': ['evidence:chunk-0080:009'], 'notes': ['野狼帮小树林遭遇后续战术链未在本 batch 中完全展开。']}
- {'requirement_id': 'character_relationship_perspective', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['未形成宗门忠诚型救援任务的完整闭合案例。']}
- 当前直接筛选到的“角色AI行为参考”证据中，未形成可闭合的“宗门忠诚型执行救援任务”完整案例；不应按模板示例补写宗门命令、奖励惩罚或疗伤回宗链。
- 当前记录未找到足够证据支持具体数值化 Utility 权重、GOAP 参数、AI 状态机配置或项目规则参数；模板要求只写行为决策链，因此不扩写技术映射表。
- 多数证据未提供韩立当时精确境界、法力余量、丹药数量或法宝耐久等数值，正式正文应写“原文未说明”或省略，不用常识补齐。

## 角色修炼历程

- {'template_name': '角色修炼历程', 'requirement_id': 'character_relationship_perspective|evidence_requirements[3]', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['当前模板支撑证据未闭合韩立元婴成功事件，只能写结丹后元婴目标。']}
- {'template_name': '角色修炼历程', 'requirement_id': 'character_relationship_perspective|evidence_requirements[1]', 'status': 'needs_review', 'evidence_ids': ['evidence:chunk-0001:002'], 'notes': ['入门阴谋有触发证据，但主体、过程和责任关系仍需复核。']}
- 在本 batch 读取到的 `角色修炼历程` 支撑证据中，只见到韩立把凝结元婴作为下一个目标，未见可写入事实的元婴成功事件。
- 部分阶段有“四年”“六十年”等时间证据，但从入门到结丹的完整绝对年月、每次闭关起止和精确年龄链条未被本记录闭合。

## 记忆情绪与执念

- {'template_name': '记忆情绪与执念', 'requirement_id': 'character_relationship_perspective', 'status': 'partial', 'evidence_ids': ['evidence:chunk-0003:011', 'evidence:chunk-0408:012'], 'notes': ['少数样例证据链较短或缺少原文 excerpt，已保守列为待核验，不进入强事实扩展。']}
- 本轮未在所选证据中确认“完整救命之恩转化为长期守护”的闭合案例；马师伯只构成受恩与谨慎信任，不足以写成守护誓约。
- 本轮未把无直接行动后果的单句情绪、旁人评价或暧昧描写提升为客观执念事实；此类内容需更多行动证据后再入正式案例。

## 邪修分析

- {'requirement_id': 'creature_deviant_practice_ecology.evidence_requirements[3]', 'status': 'partially_covered', 'content': '等阶、完整反噬规律、禁术完整机制、受害规模和长期社会影响并非每个案例都闭合；已在 pending_verifications 和 not_found_items 中标注。', 'evidence_ids': ['evidence:chunk-0033:007', 'evidence:chunk-0363:020', 'evidence:chunk-0334:016']}
- 未见可靠证据完整说明尸虫丸的具体药材、炼制地点和解药配方；当前只能确认其为秘法泡制虫卵及一年潜伏规则。
- 未见可靠证据说明玄月吸阴功在所引场景中已经完成施术或造成具体长期损害；当前只能抽取其“可强行吸纳女子元阴”和田公子意图。
- 未见可靠证据把所有魔道修士都直接定性为邪修；例如“修炼魔功”本身应与具体受害、血祭、采补、夺舍或胁迫行为区分。

## 阵法师

- {'requirement_id': 'resource_item_craft_profession.阵法师等级制度', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['未见统一等级制度。']}
- {'requirement_id': 'resource_item_craft_profession.完整阵纹配方', 'status': 'not_found_in_source', 'evidence_ids': [], 'notes': ['未见可复原的阵纹/阵图配方。']}
- 未见可靠证据给出阵法师统一等级制度或官方考核体系；只能从阵法难度、作品威力、操作者境界和旁人评价推断能力层级。
- 未见可靠证据给出完整阵图/阵纹配方清单；现有证据可记录布阵器具、灵石阵眼、阵旗阵盘位置和操纵手法，但不能补造具体阵纹。
- 未见可靠证据说明阵法师稳定收益价格或收费标准；只见天星宗以阵旗阵盘换灵石材料、韩立用灵草交换阵具/修复机会等个案。
