import { clamp } from './ledger-repository.js';

const FORBIDDEN = /\b(?:process|globalThis|global|window|document|Function|eval|constructor|require|import)\b/;

function marksOf(ledger, type) {
  return Array.isArray(ledger?.marks)
    ? ledger.marks.filter(m => m.type === type && m.consumed !== true)
    : [];
}

function tagsOf(ledger, type) {
  return Array.isArray(ledger?.tags)
    ? ledger.tags.filter(t => t.type === type && t.active !== false)
    : [];
}

export class ExpressionEvaluator {
  constructor(extraFunctions = {}) {
    this.functions = {
      clamp,
      min: Math.min,
      max: Math.max,
      abs: Math.abs,
      round: Math.round,
      floor: Math.floor,
      ceil: Math.ceil,
      scale(value, fromMin, fromMax, toMin, toMax) {
        if (fromMax === fromMin) return toMin;
        return toMin + ((value - fromMin) / (fromMax - fromMin)) * (toMax - toMin);
      },
      hasTag(entityOrLedger, tag) {
        if (Array.isArray(entityOrLedger?.tags)) return tagsOf(entityOrLedger, tag).length > 0;
        if (Array.isArray(entityOrLedger)) return entityOrLedger.includes(tag);
        return false;
      },
      hasMark(ledger, markType) {
        return marksOf(ledger, markType).length > 0;
      },
      markWeight(ledger, markType) {
        return marksOf(ledger, markType).reduce((sum, mark) => sum + (Number(mark.weight) || 0), 0);
      },
      markCount(ledger, markType) {
        return marksOf(ledger, markType).length;
      },
      ...extraFunctions,
    };
  }

  evaluate(input, context = {}) {
    if (input == null) return input;
    if (typeof input === 'number' || typeof input === 'boolean') return input;
    if (typeof input === 'string') return input;
    if (typeof input !== 'object' || typeof input.expr !== 'string') return input;

    const expr = input.expr.trim();
    if (FORBIDDEN.test(expr)) {
      throw new Error(`关系表达式包含禁止标识符: ${expr}`);
    }
    const scope = {
      event: context.event || {},
      actor: context.actor || {},
      target: context.target || {},
      subject: context.subject || {},
      object: context.object || {},
      source: context.source || {},
      witness: context.witness || {},
      group: context.group || {},
      faction: context.faction || {},
      ledger: context.ledger || null,
      world: context.world || {},
      ...this.functions,
    };
    const names = Object.keys(scope);
    const values = Object.values(scope);
    const fn = new Function(...names, `"use strict"; return (${expr});`);
    return fn(...values);
  }

  test(condition, context = {}) {
    return !!this.evaluate(condition, context);
  }
}
