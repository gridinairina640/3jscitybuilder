/**
 * @module Entities/Units
 * @layer Entities
 * @description Определяет типы юнитов и конфигурацию их найма.
 */

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