/**
 * @module Entities/Map
 * @layer Entities
 * @description Определяет структуры данных для карты и тайлов.
 * Не содержит бизнес-логики.
 */

/**
 * Типы поверхности тайлов. Влияют на проходимость и визуализацию.
 */
export enum TileType {
  GRASS = 'GRASS',
  FOREST = 'FOREST',
  MOUNTAIN = 'MOUNTAIN',
  WATER = 'WATER'
}

/**
 * DTO (Data Transfer Object) для одного тайла карты.
 * Используется в Store и для рендеринга через InstancedMesh.
 */
export interface TileData {
  /** Уникальный идентификатор тайла (UUID) */
  id: string;
  /** Координата X в сетке (целое число) */
  x: number;
  /** Координата Z в сетке (целое число) */
  z: number;
  /** Тип местности */
  type: TileType;
  /** Высота тайла (для будущей 3D генерации) */
  height: number;
  /** ID сущности (здания или юнита), занимающей тайл, или null */
  occupiedBy: string | null; 
}