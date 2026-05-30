/**
 * WorldState - 世界运行时状态
 */
import { RuntimeState } from '../abstract/runtime-state.js';

export class WorldState extends RuntimeState {
  constructor() {
    super({
      currentDay: 0,
      activeModifiers: [],
      globalStability: 50,
      totalFactions: 0,
      aliveFactions: 0,
      totalNPCs: 0,
      aliveNPCs: 0,
    });
  }

  advanceDay() {
    this.set('currentDay', (this.get('currentDay') || 0) + 1);
  }

  addModifier(modifier) {
    const modifiers = [...(this.get('activeModifiers') || [])];
    modifiers.push(modifier);
    this.set('activeModifiers', modifiers);
  }

  removeModifier(modifierId) {
    const modifiers = (this.get('activeModifiers') || []).filter(m => m.id !== modifierId);
    this.set('activeModifiers', modifiers);
  }

  tickModifiers() {
    const modifiers = this.get('activeModifiers') || [];
    const remaining = [];
    const expired = [];

    for (const mod of modifiers) {
      mod.remainingDays--;
      if (mod.remainingDays <= 0) {
        expired.push(mod);
      } else {
        remaining.push(mod);
      }
    }

    this.set('activeModifiers', remaining);
    return { remaining, expired };
  }

  getModifierEffect(effectKey) {
    let total = 0;
    for (const mod of this.get('activeModifiers') || []) {
      if (mod.effects && mod.effects[effectKey] != null) {
        total += mod.effects[effectKey] * (mod.intensity || 1);
      }
    }
    return total;
  }
}
