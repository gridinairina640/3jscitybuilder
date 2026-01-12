/**
 * @module Core/Systems/WalkerSystem
 * @layer Core
 * @description Система управления перемещением рабочих (Walkers).
 * Реализует гибридную логику: Random Walk (по дорогам) и Patrol (по маршруту).
 * Работает только с данными, не зависит от View.
 */

import { GameEntity, Coordinates } from '../../shared/types';
import { BuildingType } from '../../entities/Buildings';
import { PathfindingService } from '../utils/pathfinding';

const HISTORY_SIZE = 8; // Количество запоминаемых последних клеток для предотвращения циклов

/**
 * Проверяет, является ли тайл дорогой или зданием (проходимым для своих).
 */
const isWalkableTarget = (x: number, z: number, entities: GameEntity[]): boolean => {
  return entities.some(e => 
    (e.type === BuildingType.ROAD || Object.values(BuildingType).includes(e.type as BuildingType)) && 
    Math.round(e.position.x) === x && 
    Math.round(e.position.z) === z
  );
};

export interface WalkerDecision {
    state?: 'IDLE' | 'MOVING' | 'RETURNING' | 'WORKING';
    path?: Coordinates[];
    patrolIndex?: number;
    currentRange?: number;
    visitedTiles?: Coordinates[];
    isCalculatingPath?: boolean;
    despawn?: boolean;
}

/**
 * Основная функция принятия решений для юнита-рабочего.
 * Вызывается, когда юнит стоит на месте (IDLE) или завершил шаг.
 */
export const processWalkerDecision = async (
  walker: GameEntity,
  parentBuilding: GameEntity | undefined,
  allEntities: GameEntity[],
  pathfinding: PathfindingService
): Promise<WalkerDecision | null> => {
  
  if (walker.isCalculatingPath) return null;
  if (walker.path && walker.path.length > 0) return null;

  // 1. Logic: Arrived Home (Returning State)
  if (walker.state === 'RETURNING') {
      // Reset range, clear history
      return {
        state: 'IDLE',
        currentRange: walker.maxRange || 50,
        visitedTiles: [],
        path: []
      };
  }

  // 2. Logic: Range Limit / Return Home
  const currentRange = walker.currentRange ?? 50;
  if (currentRange <= 0 && parentBuilding) {
      return {
          state: 'RETURNING',
          isCalculatingPath: true // Will be resolved by caller calling Scheduler
      };
  }
  
  // 3. Logic: Patrol (Specific Route)
  if (parentBuilding?.patrolPath && parentBuilding.patrolPath.length > 0) {
    const currentIndex = walker.patrolIndex ?? 0;
    const targetPoint = parentBuilding.patrolPath[currentIndex];
    
    // Check if arrived at current waypoint
    const dx = Math.abs(walker.position.x - targetPoint.x);
    const dz = Math.abs(walker.position.z - targetPoint.z);

    if (dx < 0.1 && dz < 0.1) {
        const nextIndex = (currentIndex + 1) % parentBuilding.patrolPath.length;
        return { patrolIndex: nextIndex }; // Just update index, move next tick
    }
    
    // Move to target
    return {
        state: 'MOVING',
        isCalculatingPath: true, // Needs A* to waypoint
    };
  }

  // 4. Logic: Random Walk (Road Following)
  // This is synchronous logic, no A* needed for 1-step moves.
  const pos = walker.position;
  const candidates: Coordinates[] = [
    { x: Math.round(pos.x + 1), z: Math.round(pos.z) },
    { x: Math.round(pos.x - 1), z: Math.round(pos.z) },
    { x: Math.round(pos.x), z: Math.round(pos.z + 1) },
    { x: Math.round(pos.x), z: Math.round(pos.z - 1) }
  ];

  // Filter: Must be existing Road/Building
  const validMoves = candidates.filter(c => isWalkableTarget(c.x, c.z, allEntities));

  if (validMoves.length === 0) {
      return { state: 'IDLE' };
  }

  // Filter: Avoid recently visited (History)
  const history = walker.visitedTiles || [];
  const unvisitedMoves = validMoves.filter(m => 
    !history.some(h => h.x === m.x && h.z === m.z)
  );

  let nextTile: Coordinates;

  if (unvisitedMoves.length > 0) {
      // Pick random unvisited
      nextTile = unvisitedMoves[Math.floor(Math.random() * unvisitedMoves.length)];
  } else {
      // Dead end or backtracking needed: pick any valid move
      nextTile = validMoves[Math.floor(Math.random() * validMoves.length)];
  }

  const newHistory = [pos, ...history].slice(0, HISTORY_SIZE);

  return {
      state: 'MOVING',
      path: [nextTile], // Immediate 1-tile path
      currentRange: currentRange - 1,
      visitedTiles: newHistory
  };
};