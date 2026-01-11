import { GameEntity, Resources } from '../../shared/types';
import { BuildingType } from '../../entities/Buildings';

/**
 * Calculates the resource changes for a new turn based on current entities.
 * Pure function: (Entities, CurrentResources) -> Partial<Resources>
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
