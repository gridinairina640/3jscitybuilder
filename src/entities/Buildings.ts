/**
 * @module Entities/Buildings
 * @layer Entities
 * @description Определяет типы зданий и конфигурацию их стоимости.
 */

/**
 * Перечисление доступных для постройки типов зданий.
 */
export enum BuildingType {
  HOUSE = 'HOUSE',
  LUMBER_MILL = 'LUMBER_MILL',
  BARRACKS = 'BARRACKS',
  TOWER = 'TOWER',
  ROAD = 'ROAD'
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
 * Таблица стоимости строительства зданий.
 * Используется UI для проверки доступности и Store для списания ресурсов.
 */
export const BUILD_COSTS: Record<BuildingType, ResourceCost> = {
  [BuildingType.HOUSE]: { wood: 10, stone: 0, gold: 5 },
  [BuildingType.LUMBER_MILL]: { wood: 20, stone: 5, gold: 10 },
  [BuildingType.BARRACKS]: { wood: 50, stone: 20, gold: 50 },
  [BuildingType.TOWER]: { wood: 30, stone: 30, gold: 20 },
  [BuildingType.ROAD]: { stone: 1 }
};