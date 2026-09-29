import { blueprint, booth, studio } from './basic.js';
import { desert, forest, meadow, seaside, snowfield, underwater } from './nature.js';
import { moon, neon, night, skyIsland, space } from './fantasy.js';

/** 選べる世界の一覧（この順でメニューに並ぶ） */
export const WORLD_GROUPS = [
  { label: '基本', worlds: [studio, booth, blueprint] },
  { label: '自然', worlds: [meadow, seaside, snowfield, desert, forest, underwater] },
  { label: '空想', worlds: [night, space, moon, neon, skyIsland] },
];

export const WORLDS = WORLD_GROUPS.flatMap((g) => g.worlds);

export const DEFAULT_WORLD = studio.id;

export function getWorld(id) {
  return WORLDS.find((w) => w.id === id) ?? null;
}
