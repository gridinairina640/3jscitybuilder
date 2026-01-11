export enum TileType {
  GRASS = 'GRASS',
  FOREST = 'FOREST',
  MOUNTAIN = 'MOUNTAIN',
  WATER = 'WATER'
}

export interface TileData {
  id: string;
  x: number;
  z: number;
  type: TileType;
  height: number;
  occupiedBy: string | null; // Entity ID
}
