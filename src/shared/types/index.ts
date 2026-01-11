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

// Augment JSX namespace for React Three Fiber elements to prevent type errors
declare global {
  namespace JSX {
    interface IntrinsicElements {
      // Core
      group: any;
      mesh: any;
      instancedMesh: any;
      
      // Geometry
      boxGeometry: any;
      planeGeometry: any;
      sphereGeometry: any;
      coneGeometry: any;
      cylinderGeometry: any;
      ringGeometry: any;
      
      // Materials
      meshStandardMaterial: any;
      meshBasicMaterial: any;
      
      // Lights & Others
      ambientLight: any;
      directionalLight: any;
      pointLight: any;
      color: any;
    }
  }
}
