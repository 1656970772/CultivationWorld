#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WorldContextBuilder } from '../js/engine/world/services/world-context-builder.js';

const ranksData = [
  { id: 'mortal', name: '凡人', order: 0 },
  { id: 'qi_refining', name: '炼气', order: 20, cultivationRequired: 50, qiRequired: 50 },
];

const host = {
  rng: { next: () => 0 },
  ranksData,
  worldEntity: { state: {}, currentDay: 1, activeModifiers: [] },
  entityRegistry: {},
  questTemplates: [],
  tileIndex: {},
  terrainIndex: {},
  monsterSpawner: null,
  balanceConfig: {},
  modifierTemplates: {},
  techniqueRegistry: null,
  movementSystem: null,
  infoSystem: null,
  opportunitySystem: null,
  relationshipSystem: null,
  relationshipConfig: {},
  economicSystem: null,
  economicTransactionConfig: {},
  dynamicGoalsConfig: {},
  questBoard: null,
  questCompletionHandlerRegistry: null,
  questSourceStrategyRegistry: null,
  sectBountyService: null,
  sectOperationService: null,
  _calcFactionVeinOutput: () => ({}),
  _relationGoalsEnabled: () => false,
  _applyRelationEvent: () => {},
  _npcCombatPower: () => 0,
  _bestOpportunityFor: () => null,
  nearestTerrainTile: () => null,
  getFactionBuilding: () => null,
  _nearestBountyOrg: () => null,
};

const context = new WorldContextBuilder({ host, factionAI: {} }).build();

assert.equal(context.ranksData, ranksData, 'worldContext must expose TickManager ranksData to NPC executors');
console.log('worldContext 透传 ranksData');
