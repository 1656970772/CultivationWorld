const PANEL_KEYS = ['hp', 'attack', 'defense', 'speed', 'qi', 'spirit'];

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function roundPanel(attrs) {
  const out = {};
  for (const key of PANEL_KEYS) {
    out[key] = Math.max(0, Math.round(Number(attrs[key]) || 0));
  }
  out.vitality = out.hp;
  out.strength = out.attack;
  out.sense = out.spirit;
  return out;
}

function normalizeTemplates(def) {
  const templates = def?.templates || {};
  return {
    size: templates.size,
    movement: asArray(templates.movement),
    combatStyles: asArray(templates.combatStyles),
    elements: asArray(templates.elements),
    specialTypes: asArray(templates.specialTypes),
    habits: asArray(templates.habits),
  };
}

function applyMultiplier(attrs, key, multiplier) {
  attrs[key] = (Number(attrs[key]) || 0) * (Number(multiplier) || 1);
}

function applyMultipliers(attrs, multipliers, keys) {
  for (const key of keys) {
    if (multipliers && multipliers[key] != null) {
      applyMultiplier(attrs, key, multipliers[key]);
    }
  }
}

function requireTemplate(configGroup, id, label, monsterId) {
  const template = configGroup?.[id];
  if (!template) {
    throw new Error(`${monsterId}: unknown ${label} template ${id}`);
  }
  return template;
}

function applyAdjustments(attrs, adjustments = {}) {
  for (const key of PANEL_KEYS) {
    const adjustment = adjustments[key];
    if (adjustment == null) continue;
    if (typeof adjustment === 'number') {
      applyMultiplier(attrs, key, adjustment);
      continue;
    }
    if (typeof adjustment.multiply === 'number') applyMultiplier(attrs, key, adjustment.multiply);
    if (typeof adjustment.add === 'number') attrs[key] = (Number(attrs[key]) || 0) + adjustment.add;
    if (typeof adjustment.set === 'number') attrs[key] = adjustment.set;
  }
}

export function calculateMonsterAttributes(def, config) {
  const monsterId = def?.id || '(unknown)';
  const gradeKey = String(def?.grade ?? '');
  const base = config?.gradeBaselines?.[gradeKey];
  if (!base) {
    throw new Error(`monster ${monsterId} has no grade baseline for ${gradeKey}`);
  }

  const t = normalizeTemplates(def);
  const attrs = { ...base };
  const size = requireTemplate(config?.size, t.size, 'size', monsterId);
  applyMultipliers(attrs, size?.multipliers, ['hp', 'attack', 'defense', 'speed']);

  for (const id of t.movement) {
    const movement = requireTemplate(config?.movement, id, 'movement', monsterId);
    applyMultipliers(attrs, movement?.multipliers, ['attack', 'speed']);
  }
  for (const id of t.combatStyles) {
    const combatStyle = requireTemplate(config?.combatStyle, id, 'combatStyle', monsterId);
    applyMultipliers(attrs, combatStyle?.multipliers, ['attack', 'defense', 'qi', 'spirit']);
  }
  for (const id of t.specialTypes) {
    const specialType = requireTemplate(config?.specialType, id, 'specialType', monsterId);
    const multiplier = specialType?.statMultiplier;
    if (typeof multiplier === 'number') {
      for (const key of PANEL_KEYS) applyMultiplier(attrs, key, multiplier);
    }
  }

  applyAdjustments(attrs, def?.attributeAdjustments);
  return roundPanel(attrs);
}

export function resolveMonsterAttributes(def, config) {
  if (def?.templates) {
    if (!config?.gradeBaselines) {
      throw new Error(`monster ${def?.id || '(unknown)'} has templates but no monster attribute templates config`);
    }
    return calculateMonsterAttributes(def, config);
  }

  const legacy = def?.attributes || {};
  return roundPanel({
    hp: legacy.hp ?? ((legacy.vitality ?? 30) * 10),
    qi: legacy.qi ?? 0,
    attack: legacy.attack ?? legacy.strength ?? 0,
    defense: legacy.defense ?? 0,
    speed: legacy.speed ?? 0,
    spirit: legacy.spirit ?? legacy.sense ?? 0,
  });
}

function requireKnown(errors, configGroup, ids, label, monsterId) {
  for (const id of ids) {
    if (!configGroup?.[id]) {
      errors.push(`${monsterId}: unknown ${label} template ${id}`);
    }
  }
}

function skillUsesQi(skill) {
  const text = `${skill?.name || ''}${skill?.id || ''}${skill?.description || ''}`;
  return skill?.usesQi === true || /飞遁|领域|持续|追击|瞬移|水遁|遁地/.test(text);
}

export function validateMonsterDefinition(def, config) {
  const id = def?.id || '(unknown)';
  const errors = [];
  const warnings = [];
  const t = normalizeTemplates(def);

  if (!config?.gradeBaselines?.[String(def?.grade)]) {
    errors.push(`${id}: grade baseline missing for ${def?.grade}`);
  }
  if (typeof t.size !== 'string' || !t.size) {
    errors.push(`${id}: templates.size must be one string`);
  }
  if (t.size && !config?.size?.[t.size]) {
    errors.push(`${id}: unknown size template ${t.size}`);
  }

  requireKnown(errors, config?.movement, t.movement, 'movement', id);
  requireKnown(errors, config?.combatStyle, t.combatStyles, 'combatStyle', id);
  requireKnown(errors, config?.element, t.elements, 'element', id);
  requireKnown(errors, config?.specialType, t.specialTypes, 'specialType', id);
  requireKnown(errors, config?.habit, t.habits, 'habit', id);

  if (t.specialTypes.includes('normal') && t.specialTypes.length > 1) {
    errors.push(`${id}: normal special type cannot be combined with other special types`);
  }

  const elementHasNumericMultiplier = t.elements.some((elementId) => {
    const element = config?.element?.[elementId];
    return !!(element?.multipliers || element?.statMultiplier);
  });
  if (elementHasNumericMultiplier) {
    errors.push(`${id}: element templates must not modify panel attributes`);
  }

  const skills = Array.isArray(def?.skills) ? def.skills : [];
  for (const skill of skills) {
    if (!['movement', 'active', 'passive'].includes(skill?.type)) {
      errors.push(`${id}: skill ${skill?.id || skill?.name || '(unknown)'} must use type movement, active, or passive`);
    }
    if (skill?.type !== 'passive' && skillUsesQi(skill) && !skill.cost) {
      errors.push(`${id}: skill ${skill?.id || skill?.name || '(unknown)'} needs cost for qi usage`);
    }
    if (skill?.cost?.mode && !['perUse', 'perDay', 'continuous'].includes(skill.cost.mode)) {
      errors.push(`${id}: skill ${skill?.id || skill?.name || '(unknown)'} has invalid cost mode ${skill.cost.mode}`);
    }
  }

  if ((def?.grade || 0) <= 2 && t.specialTypes.includes('normal') && skills.length > (config?.validation?.lowGradeNormalMaxSkills ?? 2)) {
    warnings.push(`${id}: low grade normal monster has many skills`);
  }

  let calculated = null;
  try {
    calculated = calculateMonsterAttributes(def, config);
  } catch {
    calculated = null;
  }

  const base = config?.gradeBaselines?.[String(def?.grade)] || null;
  const hasStrengthSource = !!(def?.reason || def?.source || def?.description);
  if (calculated && base) {
    const speedRatio = calculated.speed / Math.max(1, base.speed);
    const attackRatio = calculated.attack / Math.max(1, base.attack);
    const spiritRatio = calculated.spirit / Math.max(1, base.spirit);
    if (speedRatio > (config?.validation?.maxSpeedMultiplierWithoutReason ?? 2.2) && !hasStrengthSource) {
      errors.push(`${id}: speed multiplier requires reason, source, or description`);
    }
    if (attackRatio > (config?.validation?.maxAttackMultiplierWithoutReason ?? 2.5) && !hasStrengthSource) {
      errors.push(`${id}: attack multiplier requires reason, source, or description`);
    }
    if (spiritRatio > (config?.validation?.maxSpiritMultiplierWithoutReason ?? 3.0) && !hasStrengthSource) {
      errors.push(`${id}: spirit multiplier requires reason, source, or description`);
    }
  }

  return { errors, warnings };
}

export function validateMonsterDefinitions(monsters, config) {
  const errors = [];
  const warnings = [];
  for (const def of monsters || []) {
    if (!def?.id) continue;
    const result = validateMonsterDefinition(def, config);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  return { errors, warnings };
}
