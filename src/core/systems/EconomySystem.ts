/**
 * @module Core/Economy
 * @layer Core
 * @description Чистая логика расчета экономики. Не зависит от React или Store.
 */

import { GameEntity, Resources } from '../../shared/types';
import { BuildingType } from '../../entities/Buildings';

/**
 * Рассчитывает изменения ресурсов за ход на основе списка сущностей.
 * 
 * @param entities Массив всех игровых сущностей.
 * @returns {Partial<Resources>} Объект с дельтой ресурсов (например, { wood: 10 }).
 * 
 * @example
 * const income = calculateTurnIncome(currentEntities);
 * // income = { wood: 10, gold: 2 }
 */
export const calculateTurnIncome = (entities: GameEntity[]): Partial<Resources> => {
  let woodGain = 0;
  let goldGain = 0;

  entities.forEach(e => {
    if (e.type === BuildingType.LUMBER_MILL) woodGain += 10;
    if (e.type === BuildingType.HOUSE) goldGain += 2;
  });

  return {
    wood: woodGain,
    gold: goldGain
  };
};