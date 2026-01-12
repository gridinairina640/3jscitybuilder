/**
 * @module Shared/Types
 * @layer Shared
 * @description Глобальные типы данных, используемые во всех слоях приложения.
 */

import React from 'react';
import { BuildingType } from '../../entities/Buildings';
import { UnitType } from '../../entities/Units';

/**
 * Базовая структура координат в 3D мире (X, Z).
 * Y обычно игнорируется или равен 0 на плоскости.
 */
export interface Coordinates {
  x: number;
  z: number;
}

/**
 * Состояние ресурсов игрока.
 */
export interface Resources {
  wood: number;
  stone: number;
  gold: number;
  /** Текущее занятое население */
  population: number;
  /** Максимально доступное жилье */
  populationCap: number;
}

/** Характеристики боевого юнита */
export interface UnitStats {
  speed: number;   // Тайлов в секунду
  attack: number;
  defense: number;
  range: number;
}

export type EntityState = 'IDLE' | 'MOVING' | 'ATTACKING' | 'WORKING' | 'RETURNING';

/**
 * Основная игровая сущность (Здание или Юнит).
 * Существует в игровом мире и рендерится в 3D.
 */
export interface GameEntity {
  id: string;
  type: BuildingType | UnitType;
  position: Coordinates;
  health: number;
  maxHealth: number;
  faction: 'PLAYER' | 'ENEMY';
  
  // --- RTS Mechanics ---
  state: EntityState;
  stats?: UnitStats; // Только для юнитов
  
  // --- Walker / Economy Mechanics (Workers) ---
  homeId?: string;           // ID здания, к которому приписан юнит
  currentRange?: number;     // Оставшийся запас хода
  maxRange?: number;         // Максимальный радиус действия
  visitedTiles?: Coordinates[]; // История последних посещенных клеток (Random Walk memory)
  
  // --- Patrol Mechanics (Buildings & Units) ---
  patrolPath?: Coordinates[]; // Маршрут патрулирования (для зданий) или активный путь (для юнитов)
  patrolIndex?: number;       // Индекс текущей целевой точки в patrolPath
  
  // --- Свойства для поиска пути (только для юнитов) ---
  
  /** Текущий рассчитанный путь движения (A*) */
  path?: Coordinates[];
  /** Флаг, указывающий, что идет асинхронный расчет пути */
  isCalculatingPath?: boolean;
}

/**
 * Событие игрового мира, генерируемое AI или сценарием.
 */
export interface GameEvent {
  title: string;
  description: string;
  effect?: string;
  severity: 'GOOD' | 'BAD' | 'NEUTRAL';
}

// Augment JSX namespace for React Three Fiber elements to prevent type errors.
type R3FElement = any;

declare global {
  namespace JSX {
    interface IntrinsicElements {
      group: R3FElement;
      mesh: R3FElement;
      instancedMesh: R3FElement;
      primitive: R3FElement;
      boxGeometry: R3FElement;
      planeGeometry: R3FElement;
      sphereGeometry: R3FElement;
      coneGeometry: R3FElement;
      cylinderGeometry: R3FElement;
      ringGeometry: R3FElement;
      torusGeometry: R3FElement;
      meshStandardMaterial: R3FElement;
      meshBasicMaterial: R3FElement;
      meshPhongMaterial: R3FElement;
      ambientLight: R3FElement;
      directionalLight: R3FElement;
      pointLight: R3FElement;
      spotLight: R3FElement;
      color: R3FElement;
      [elemName: string]: any;
    }
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      group: R3FElement;
      mesh: R3FElement;
      instancedMesh: R3FElement;
      primitive: R3FElement;
      boxGeometry: R3FElement;
      planeGeometry: R3FElement;
      sphereGeometry: R3FElement;
      coneGeometry: R3FElement;
      cylinderGeometry: R3FElement;
      ringGeometry: R3FElement;
      torusGeometry: R3FElement;
      meshStandardMaterial: R3FElement;
      meshBasicMaterial: R3FElement;
      meshPhongMaterial: R3FElement;
      ambientLight: R3FElement;
      directionalLight: R3FElement;
      pointLight: R3FElement;
      spotLight: R3FElement;
      color: R3FElement;
      [elemName: string]: any;
    }
  }
}