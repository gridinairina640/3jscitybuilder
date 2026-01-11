import { BuildingType } from '../../entities/Buildings';
import { UnitType } from '../../entities/Units';

export interface Coordinates {
  x: number;
  z: number;
}

export interface Resources {
  wood: number;
  stone: number;
  gold: number;
  population: number;
  populationCap: number;
}

export interface GameEntity {
  id: string;
  type: BuildingType | UnitType;
  position: Coordinates;
  health: number;
  maxHealth: number;
  faction: 'PLAYER' | 'ENEMY';
  // Pathfinding props
  path?: Coordinates[];
  isCalculatingPath?: boolean;
}

export interface GameEvent {
  title: string;
  description: string;
  effect?: string;
  severity: 'GOOD' | 'BAD' | 'NEUTRAL';
}
