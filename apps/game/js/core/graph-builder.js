const NODE_TYPES = {
  FACTION: 'faction',
  NPC: 'npc',
  EVENT: 'event_template',
  RULE: 'rule',
  MODIFIER: 'modifier'
};

const EDGE_TYPES = {
  LEADER_OF: 'leader_of',
  DIPLOMACY: 'diplomacy',
  RULE_TRIGGERS: 'rule_triggers',
  RULE_CONDITION: 'rule_condition',
  MODIFIER_ENABLES: 'modifier_enables',
  PERSONALITY_INFLUENCE: 'personality_influence',
  EVENT_EFFECT: 'event_effect',
  STABILITY_FACTOR: 'stability_factor',
  MODIFIER_EFFECT: 'modifier_effect',
  RELATIONSHIP: 'relationship'
};

/** 关系类型 → 中文标签（关系网可视化，ADR-027）。与 relationship.json edgeTypes 对齐。 */
const RELATION_TYPE_LABELS = {
  master: '师傅', disciple: '徒弟', dao_companion: '道侣', kin: '血亲',
  same_sect: '同门', ally: '盟友', rival: '竞争', enemy: '宿敌',
  benefactor: '恩人', grudge: '仇怨', gratitude: '恩义',
  spirit_pet: '灵宠', mount: '坐骑', beast_grudge: '妖兽仇敌', territory_threat: '领地入侵',
  pack_member: '同群', pack_leader: '妖群首领', beast_rival: '妖兽争斗'
};

const FACTION_COLORS = {
  righteous: '#2ecc71',
  evil: '#e74c3c',
  neutral: '#3498db',
  demon: '#9b59b6'
};

export class GraphBuilder {
  constructor() {
    this.nodes = [];
    this.edges = [];
  }

  buildFromConfigs(configs) {
    this.nodes = [];
    this.edges = [];

    const events = configs.events || [];
    const rules = configs.worldRules || configs.rules || [];
    const modifiers = configs.modifierTemplates || configs.modifiers || [];

    this._buildFactionNodes(configs.factions);
    this._buildNPCNodes(configs.npcs);
    this._buildEventNodes(events);
    this._buildRuleNodes(rules);
    this._buildModifierNodes(modifiers);

    this._buildLeaderEdges(configs.factions, configs.npcs);
    this._buildDiplomacyEdges(configs.factions);
    this._buildRuleTriggerEdges(rules);
    this._buildRuleConditionEdges(rules, configs.factions);
    this._buildModifierEnableEdges(rules, modifiers);
    this._buildPersonalityInfluenceEdges(configs.npcs, configs.factions);
    this._buildEventEffectEdges(events);
    this._buildModifierEffectEdges(modifiers, configs.factions);

    return { nodes: this.nodes, edges: this.edges };
  }

  updateFromWorldState(worldState) {
    if (!worldState) return;

    for (const node of this.nodes) {
      if (node.type === NODE_TYPES.FACTION && worldState.factions) {
        const f = worldState.factions instanceof Map
          ? worldState.factions.get(node.dataId)
          : worldState.factions[node.dataId];
        if (f) {
          node.runtimeData = {
            stability: f.stability,
            disciples: f.resources?.disciples,
            spiritStone: f.resources?.low_spirit_stone,
            food: f.resources?.food,
            territoryCount: f.territory?.length || 0,
            atWar: f.atWar,
            warTarget: f.warTarget
          };
        }
      }
      if (node.type === NODE_TYPES.NPC && worldState.npcs) {
        const n = worldState.npcs instanceof Map
          ? worldState.npcs.get(node.dataId)
          : worldState.npcs[node.dataId];
        if (n) {
          node.runtimeData = {
            alive: n.alive,
            personality: { ...n.personality }
          };
        }
      }
    }

    for (const edge of this.edges) {
      if (edge.edgeType === EDGE_TYPES.DIPLOMACY && worldState.factions) {
        const f = worldState.factions instanceof Map
          ? worldState.factions.get(edge.sourceDataId)
          : worldState.factions[edge.sourceDataId];
        if (f && f.relations) {
          edge.runtimeValue = f.relations[edge.targetDataId] ?? edge.value;
        }
      }
    }

    if (worldState.activeModifiers) {
      const activeTypes = new Set(worldState.activeModifiers.map(m => m.type));
      for (const node of this.nodes) {
        if (node.type === NODE_TYPES.MODIFIER) {
          node.active = activeTypes.has(node.dataId);
        }
      }
    }
  }

  // --- Faction 节点 ---
  _buildFactionNodes(factions) {
    for (const f of factions) {
      this.nodes.push({
        id: `faction_${f.id}`,
        dataId: f.id,
        type: NODE_TYPES.FACTION,
        label: f.name,
        subType: f.type,
        color: FACTION_COLORS[f.type] || '#888',
        runtimeData: {
          stability: f.stability,
          disciples: f.resources.disciples,
          spiritStone: f.resources.low_spirit_stone,
          food: f.resources.food
        }
      });
    }
  }

  // --- NPC 节点 ---
  _buildNPCNodes(npcs) {
    for (const n of npcs) {
      const factionNode = this.nodes.find(nd => nd.dataId === n.factionId);
      this.nodes.push({
        id: `npc_${n.id}`,
        dataId: n.id,
        type: NODE_TYPES.NPC,
        label: n.name,
        color: factionNode ? factionNode.color : '#888',
        factionId: n.factionId,
        runtimeData: {
          alive: n.alive,
          personality: { ...n.personality }
        }
      });
    }
  }

  // --- 事件模板节点 ---
  _buildEventNodes(events) {
    for (const e of events) {
      this.nodes.push({
        id: `event_${e.type}`,
        dataId: e.type,
        type: NODE_TYPES.EVENT,
        label: e.name,
        color: '#e67e22',
        description: e.description
      });
    }
  }

  // --- 规则节点 ---
  _buildRuleNodes(rules) {
    for (const r of rules) {
      this.nodes.push({
        id: `rule_${r.id}`,
        dataId: r.id,
        type: NODE_TYPES.RULE,
        label: r.name,
        color: '#95a5a6',
        probability: r.probability,
        cooldown: r.cooldown,
        description: r.description
      });
    }
  }

  // --- 世界状态节点 ---
  _buildModifierNodes(modifiers) {
    for (const m of modifiers) {
      this.nodes.push({
        id: `modifier_${m.type}`,
        dataId: m.type,
        type: NODE_TYPES.MODIFIER,
        label: m.name,
        color: '#1abc9c',
        active: false,
        description: m.description
      });
    }
  }

  // --- NPC→Faction 掌门关系 ---
  _buildLeaderEdges(factions, npcs) {
    for (const f of factions) {
      const npc = npcs.find(n => n.id === f.leader);
      if (!npc) continue;
      this.edges.push({
        id: `edge_leader_${npc.id}_${f.id}`,
        source: `npc_${npc.id}`,
        target: `faction_${f.id}`,
        sourceDataId: npc.id,
        targetDataId: f.id,
        edgeType: EDGE_TYPES.LEADER_OF,
        label: '掌门',
        description: `${npc.name} 是 ${f.name} 的掌门，性格直接影响势力决策`,
        lineStyle: 'solid',
        influence: 'neutral'
      });
    }
  }

  // --- Faction↔Faction 外交关系 ---
  _buildDiplomacyEdges(factions) {
    for (let i = 0; i < factions.length; i++) {
      for (let j = i + 1; j < factions.length; j++) {
        const f1 = factions[i];
        const f2 = factions[j];
        const relation = f1.relations[f2.id] || 0;
        if (relation === 0) continue;
        this.edges.push({
          id: `edge_diplo_${f1.id}_${f2.id}`,
          source: `faction_${f1.id}`,
          target: `faction_${f2.id}`,
          sourceDataId: f1.id,
          targetDataId: f2.id,
          edgeType: EDGE_TYPES.DIPLOMACY,
          label: `${relation > 0 ? '+' : ''}${relation}`,
          value: relation,
          runtimeValue: relation,
          description: `${f1.name} ↔ ${f2.name} 好感度 ${relation}`,
          lineStyle: 'solid',
          influence: relation > 0 ? 'positive' : 'negative'
        });
      }
    }
  }

  /**
   * 注入运行时关系网边（ADR-027）。关系来自世界快照（worldState.relationships），
   * 非静态配置，故独立于 buildFromConfigs，可在每次 updateFromWorldState 后调用刷新。
   * 边的两端实体若无对应节点（如妖兽），按需创建轻量节点。
   * @param {Array<{fromId,toId,type,affinity,strength}>} relationships
   */
  buildRelationshipEdges(relationships) {
    // 先清除旧的关系边（避免重复堆积），保留其它类型边。
    this.edges = this.edges.filter(e => e.edgeType !== EDGE_TYPES.RELATIONSHIP);
    if (!Array.isArray(relationships)) return;

    const nodeId = (id) => {
      // 已有 npc 节点优先；否则视实体类型建轻量节点。
      const existing = this.nodes.find(n => n.dataId === id);
      if (existing) return existing.id;
      // 妖兽 / 其它实体：按 id 前缀建占位节点。
      const isMonster = String(id).startsWith('beast_') || String(id).startsWith('monster_');
      const pid = `${isMonster ? 'monster' : 'entity'}_${id}`;
      if (!this.nodes.find(n => n.id === pid)) {
        this.nodes.push({
          id: pid,
          dataId: id,
          type: isMonster ? 'monster' : 'entity',
          label: id,
          color: isMonster ? '#9b59b6' : '#888',
          runtimeData: {},
        });
      }
      return pid;
    };

    for (const rel of relationships) {
      if (!rel || !rel.fromId || !rel.toId || !rel.type) continue;
      const source = nodeId(rel.fromId);
      const target = nodeId(rel.toId);
      const label = RELATION_TYPE_LABELS[rel.type] || rel.type;
      const affinity = rel.affinity ?? 0;
      this.edges.push({
        id: `edge_rel_${rel.fromId}_${rel.toId}_${rel.type}`,
        source,
        target,
        sourceDataId: rel.fromId,
        targetDataId: rel.toId,
        edgeType: EDGE_TYPES.RELATIONSHIP,
        relationType: rel.type,
        label,
        value: affinity,
        strength: rel.strength ?? 0,
        description: `${rel.fromId} → ${rel.toId}：${label}（好感 ${affinity}，强度 ${rel.strength ?? 0}）`,
        lineStyle: affinity < 0 ? 'dashed' : 'solid',
        influence: affinity > 0 ? 'positive' : (affinity < 0 ? 'negative' : 'neutral'),
      });
    }
  }

  // --- Rule→Event 触发 ---
  _buildRuleTriggerEdges(rules) {
    for (const r of rules) {
      this.edges.push({
        id: `edge_trigger_${r.id}_${r.event_type}`,
        source: `rule_${r.id}`,
        target: `event_${r.event_type}`,
        edgeType: EDGE_TYPES.RULE_TRIGGERS,
        label: `触发 (${(r.probability * 100).toFixed(0)}%)`,
        description: `${r.name}: 满足条件后以 ${(r.probability * 100).toFixed(0)}% 概率触发`,
        lineStyle: 'solid',
        influence: 'neutral'
      });
    }
  }

  // --- Rule 条件边 ---
  _buildRuleConditionEdges(rules, factions) {
    for (const r of rules) {
      const c = r.conditions;
      if (!c) continue;

      if (c.relation_below !== undefined) {
        this.edges.push({
          id: `edge_cond_${r.id}_rel_below`,
          source: `rule_${r.id}`,
          target: null,
          edgeType: EDGE_TYPES.RULE_CONDITION,
          label: `关系 < ${c.relation_below}`,
          description: `需要势力对间好感度低于 ${c.relation_below}`,
          lineStyle: 'dashed',
          influence: 'negative',
          conditionType: 'relation_below',
          conditionValue: c.relation_below
        });
      }
      if (c.relation_above !== undefined) {
        this.edges.push({
          id: `edge_cond_${r.id}_rel_above`,
          source: `rule_${r.id}`,
          target: null,
          edgeType: EDGE_TYPES.RULE_CONDITION,
          label: `关系 > ${c.relation_above}`,
          description: `需要势力对间好感度高于 ${c.relation_above}`,
          lineStyle: 'dashed',
          influence: 'positive',
          conditionType: 'relation_above',
          conditionValue: c.relation_above
        });
      }
      if (c.stability_below !== undefined) {
        this.edges.push({
          id: `edge_cond_${r.id}_stab_below`,
          source: `rule_${r.id}`,
          target: null,
          edgeType: EDGE_TYPES.RULE_CONDITION,
          label: `稳定度 < ${c.stability_below}`,
          description: `需要势力稳定度低于 ${c.stability_below}`,
          lineStyle: 'dashed',
          influence: 'negative',
          conditionType: 'stability_below',
          conditionValue: c.stability_below
        });
      }
      if (c.leader_loyalty_below !== undefined) {
        this.edges.push({
          id: `edge_cond_${r.id}_loyalty`,
          source: `rule_${r.id}`,
          target: null,
          edgeType: EDGE_TYPES.RULE_CONDITION,
          label: `忠诚度 < ${c.leader_loyalty_below}`,
          description: `需要掌门忠诚度低于 ${c.leader_loyalty_below}`,
          lineStyle: 'dashed',
          influence: 'negative',
          conditionType: 'leader_loyalty_below',
          conditionValue: c.leader_loyalty_below
        });
      }
      if (c.faction_type) {
        for (const f of factions) {
          if (f.type === c.faction_type) {
            this.edges.push({
              id: `edge_cond_${r.id}_type_${f.id}`,
              source: `rule_${r.id}`,
              target: `faction_${f.id}`,
              edgeType: EDGE_TYPES.RULE_CONDITION,
              label: `类型=${c.faction_type}`,
              description: `规则仅对 ${c.faction_type} 类型势力生效`,
              lineStyle: 'dashed',
              influence: 'neutral'
            });
          }
        }
      }
    }
  }

  // --- Modifier→Rule 激活条件 ---
  _buildModifierEnableEdges(rules, modifiers) {
    for (const r of rules) {
      if (!r.conditions?.world_modifier_active) continue;
      const modType = r.conditions.world_modifier_active;
      const mod = modifiers.find(m => m.type === modType);
      if (!mod) continue;
      this.edges.push({
        id: `edge_mod_enable_${modType}_${r.id}`,
        source: `modifier_${modType}`,
        target: `rule_${r.id}`,
        edgeType: EDGE_TYPES.MODIFIER_ENABLES,
        label: '激活条件',
        description: `${mod.name} 激活时，启用规则 ${r.name}`,
        lineStyle: 'solid',
        influence: 'neutral'
      });
    }
  }

  // --- NPC性格→势力决策 影响链 ---
  _buildPersonalityInfluenceEdges(npcs, factions) {
    const traitEffects = [
      { trait: 'ambition', desc: '野心', effects: 'attack权重+0.5, expand+0.3' },
      { trait: 'caution', desc: '谨慎', effects: 'defend权重+0.4, attack-0.3' },
      { trait: 'loyalty', desc: '忠诚', effects: '稳定度±(>80:+1, <40:-2)' },
      { trait: 'diplomacy', desc: '外交', effects: 'ally权重+0.4, trade+0.3' }
    ];

    for (const npc of npcs) {
      const faction = factions.find(f => f.leader === npc.id);
      if (!faction) continue;

      for (const te of traitEffects) {
        const val = npc.personality[te.trait];
        let influence = 'neutral';
        if (te.trait === 'ambition') influence = val > 60 ? 'negative' : 'positive';
        if (te.trait === 'caution') influence = val > 60 ? 'positive' : 'negative';
        if (te.trait === 'loyalty') influence = val > 60 ? 'positive' : 'negative';
        if (te.trait === 'diplomacy') influence = val > 50 ? 'positive' : 'neutral';

        this.edges.push({
          id: `edge_personality_${npc.id}_${te.trait}_${faction.id}`,
          source: `npc_${npc.id}`,
          target: `faction_${faction.id}`,
          edgeType: EDGE_TYPES.PERSONALITY_INFLUENCE,
          label: `${te.desc}=${val}`,
          description: `${npc.name} ${te.desc}(${val}) → ${faction.name}: ${te.effects}`,
          lineStyle: 'dashed',
          influence,
          personalityTrait: te.trait,
          personalityValue: val
        });
      }
    }
  }

  // --- 事件结算→势力 影响边 ---
  _buildEventEffectEdges(events) {
    const effectMap = {
      war: [
        { label: '弟子损失', influence: 'negative' },
        { label: '关系-20', influence: 'negative' },
        { label: '稳定度变化', influence: 'negative' },
        { label: '领地转移', influence: 'neutral' }
      ],
      alliance: [
        { label: '关系+20', influence: 'positive' },
        { label: '稳定度+5', influence: 'positive' }
      ],
      betrayal: [
        { label: '稳定度-25', influence: 'negative' },
        { label: '弟子-20%', influence: 'negative' },
        { label: '掌门更替', influence: 'negative' }
      ],
      civil_war: [
        { label: '稳定度-30', influence: 'negative' },
        { label: '领地-20%', influence: 'negative' },
        { label: '弟子-25%', influence: 'negative' }
      ],
      raid: [
        { label: '资源-15%', influence: 'negative' },
        { label: '关系-15', influence: 'negative' }
      ],
      demon_invasion: [
        { label: '弟子-20%', influence: 'negative' },
        { label: '领地-15%', influence: 'negative' },
        { label: '关系-25', influence: 'negative' }
      ],
      trade: [
        { label: '资源互换', influence: 'positive' },
        { label: '关系+10', influence: 'positive' }
      ],
      leader_death: [
        { label: '稳定度-20', influence: 'negative' },
        { label: '掌门更替', influence: 'negative' }
      ],
      realm_contest: [
        { label: '参与者关系-8', influence: 'negative' },
        { label: '胜者获宝', influence: 'positive' }
      ],
      great_war: [
        { label: '全阵营交战', influence: 'negative' },
        { label: '正邪关系-30', influence: 'negative' },
        { label: '同阵营关系+10', influence: 'positive' }
      ]
    };

    for (const e of events) {
      const effects = effectMap[e.type] || [];
      for (let i = 0; i < effects.length; i++) {
        this.edges.push({
          id: `edge_effect_${e.type}_${i}`,
          source: `event_${e.type}`,
          target: null,
          edgeType: EDGE_TYPES.EVENT_EFFECT,
          label: effects[i].label,
          description: `${e.name} 结算: ${effects[i].label}`,
          lineStyle: 'solid',
          influence: effects[i].influence
        });
      }
    }
  }

  // --- Modifier→Faction 效果边 ---
  _buildModifierEffectEdges(modifiers, factions) {
    const effectDescMap = {
      evil_aggression: { desc: '邪派攻击权重+', targetType: 'evil', influence: 'negative' },
      righteous_defense: { desc: '正派防御权重+', targetType: 'righteous', influence: 'positive' },
      demon_aggression: { desc: '妖族攻击权重+', targetType: 'demon', influence: 'negative' },
      all_aggression: { desc: '全体攻击欲望+', targetType: null, influence: 'negative' },
      all_stability: { desc: '全体稳定度', targetType: null, influence: 'negative' },
      expansion_desire: { desc: '扩张欲望+', targetType: null, influence: 'neutral' }
    };

    for (const mod of modifiers) {
      if (!mod.effects) continue;
      for (const [effectKey, effectVal] of Object.entries(mod.effects)) {
        const desc = effectDescMap[effectKey];
        if (!desc) continue;

        if (desc.targetType) {
          for (const f of factions) {
            if (f.type === desc.targetType) {
              this.edges.push({
                id: `edge_modeff_${mod.type}_${effectKey}_${f.id}`,
                source: `modifier_${mod.type}`,
                target: `faction_${f.id}`,
                edgeType: EDGE_TYPES.MODIFIER_EFFECT,
                label: `${desc.desc}${effectVal > 0 ? '+' : ''}${(effectVal * 100).toFixed(0)}%`,
                description: `${mod.name} → ${f.name}: ${desc.desc}${(effectVal * 100).toFixed(0)}%`,
                lineStyle: 'solid',
                influence: desc.influence
              });
            }
          }
        } else {
          this.edges.push({
            id: `edge_modeff_${mod.type}_${effectKey}_all`,
            source: `modifier_${mod.type}`,
            target: null,
            edgeType: EDGE_TYPES.MODIFIER_EFFECT,
            label: `${desc.desc}${effectVal > 0 ? '+' : ''}${(effectVal * 100).toFixed(0)}%`,
            description: `${mod.name} → 所有势力: ${desc.desc}`,
            lineStyle: 'solid',
            influence: desc.influence,
            targetAll: true
          });
        }
      }
    }
  }

  _resolveId(ref) {
    if (ref === null || ref === undefined) return null;
    return typeof ref === 'object' ? ref.id : ref;
  }

  getConnectedNodeIds(nodeId, maxDepth = 2) {
    const connected = new Set();
    const connectedEdges = new Set();
    const queue = [{ id: nodeId, depth: 0 }];
    connected.add(nodeId);

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (depth >= maxDepth) continue;

      for (const edge of this.edges) {
        const src = this._resolveId(edge.source);
        const tgt = this._resolveId(edge.target);
        if (src === id && tgt) {
          connectedEdges.add(edge.id);
          if (!connected.has(tgt)) {
            connected.add(tgt);
            queue.push({ id: tgt, depth: depth + 1 });
          }
        }
        if (tgt === id && src) {
          connectedEdges.add(edge.id);
          if (!connected.has(src)) {
            connected.add(src);
            queue.push({ id: src, depth: depth + 1 });
          }
        }
      }
    }

    return { nodeIds: connected, edgeIds: connectedEdges };
  }

  getVisibleData(filters) {
    const visibleTypes = new Set(
      Object.entries(filters)
        .filter(([, v]) => v)
        .map(([k]) => k)
    );

    const visibleNodes = this.nodes.filter(n => visibleTypes.has(n.type));
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));

    const visibleEdges = this.edges.filter(e => {
      const src = this._resolveId(e.source);
      const tgt = this._resolveId(e.target);
      return visibleNodeIds.has(src) && (tgt === null || visibleNodeIds.has(tgt));
    });

    return {
      nodes: visibleNodes,
      edges: visibleEdges
        .filter(e => this._resolveId(e.target) !== null)
        .map(e => ({ ...e, source: this._resolveId(e.source), target: this._resolveId(e.target) }))
    };
  }
}

export { NODE_TYPES, EDGE_TYPES, FACTION_COLORS };
