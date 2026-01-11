import { Resources } from '../shared/types';

export enum UnitType {
  WORKER = 'WORKER',
  SOLDIER = 'SOLDIER',
  HERO = 'HERO'
}

export const UNIT_COSTS: Record<UnitType, Partial<Resources>> = {
  [UnitType.WORKER]: { gold: 10, population: 1 },
  [UnitType.SOLDIER]: { gold: 30, wood: 10, population: 1 },
  [UnitType.HERO]: { gold: 100, stone: 20, population: 1 }
};
