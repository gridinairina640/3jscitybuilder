/**
 * @module Entities/Units
 * @layer Entities
 * @description Определяет типы юнитов и конфигурацию их найма.
 */

import { UnitStats } from '../shared/types';

/**
 * Перечисление доступных типов юнитов.
 */
export enum UnitType {
  WORKER = 'WORKER',
  SOLDIER = 'SOLDIER',
  HERO = 'HERO'
}

/**
 * Локальное определение стоимости ресурсов для разрыва циклических зависимостей.
 */
type ResourceCost = {
  wood?: number;
  stone?: number;
  gold?: number;
  population?: number;
  populationCap?: number;
};

/**
 * Таблица стоимости найма юнитов.
 * Включает требования к населению (population).
 */
export const UNIT_COSTS: Record<UnitType, ResourceCost> = {
  [UnitType.WORKER]: { gold: 10, population: 1 },
  [UnitType.SOLDIER]: { gold: 30, wood: 10, population: 1 },
  [UnitType.HERO]: { gold: 100, stone: 20, population: 1 }
};

/**
 * Боевые и ходовые характеристики юнитов.
 */
export const UNIT_STATS: Record<UnitType, UnitStats> = {
  [UnitType.WORKER]: { speed: 2.0, attack: 2, defense: 1, range: 1 },
  [UnitType.SOLDIER]: { speed: 3.0, attack: 10, defense: 5, range: 1 },
  [UnitType.HERO]: { speed: 4.5, attack: 25, defense: 15, range: 2 }
};