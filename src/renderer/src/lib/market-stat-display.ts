import type { ItemStatDefinition } from "../../../shared/item-stat-ranges";

/** Proc mappings are scoped to a definition with a paired tooltip oracle. */
export function marketTriggeredSkillDescription(definition: ItemStatDefinition | null,
  stats: readonly { statId: number; value: number }[]): string | null {
  const skill = definition?.triggeredSkill;
  if (!definition || !skill) return null;
  const value = (id: number) => stats.find(stat => stat.statId === id)?.value;
  const chance = value(skill.chanceStatId);
  const level = value(skill.levelStatId);
  const skillId = value(skill.skillStatId);
  const expectedId = definition.stats.find(stat => stat.statId === skill.skillStatId)?.minimum;
  if (chance === undefined || level === undefined || skillId !== expectedId) return null;
  return `${chance}% Chance ${skill.trigger}: ${skill.name} (Level ${level})`;
}

export function marketTriggeredSkillStatIds(definition: ItemStatDefinition | null): number[] {
  const skill = definition?.triggeredSkill;
  return skill ? [skill.skillStatId, skill.chanceStatId, skill.levelStatId] : [];
}
