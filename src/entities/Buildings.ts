import { Resources } from '../shared/types';

export enum BuildingType {
  HOUSE = 'HOUSE',
  LUMBER_MILL = 'LUMBER_MILL',
  BARRACKS = 'BARRACKS',
  TOWER = 'TOWER',
  ROAD = 'ROAD'
}

export const BUILD_COSTS: Record<BuildingType, Partial<Resources>> = {
  [BuildingType.HOUSE]: { wood: 10, stone: 0, gold: 5 },
  [BuildingType.LUMBER_MILL]: { wood: 20, stone: 5, gold: 10 },
  [BuildingType.BARRACKS]: { wood: 50, stone: 20, gold: 50 },
  [BuildingType.TOWER]: { wood: 30, stone: 30, gold: 20 },
  [BuildingType.ROAD]: { stone: 1 }
};
