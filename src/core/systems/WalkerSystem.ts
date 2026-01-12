/**
 * @module Core/Systems/WalkerSystem
 * @layer Core
 * @description Система управления перемещением рабочих (Walkers).
 * Реализует гибридную логику: Random Walk (по дорогам) и Patrol (по маршруту).
 * Работает только с данными, не зависит от View.
 */

import { GameEntity, Coordinates } from '../../shared/types';
import { BuildingType } from '../../entities/Buildings';
import { UnitType } from '../../entities/Units';
import { TileData, TileType } from '../../entities/Map';
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

// Helper to find nearest tile of specific type
const findNearestTileType = (pos: Coordinates, type: TileType, tiles: TileData[], maxDist: number = 30): Coordinates | null => {
    let nearest: Coordinates | null = null;
    let minSqDist = maxDist * maxDist;

    // Optimization: This linear scan is okay for < 10k tiles. 
    // For larger maps, use a spatial hash or chunk system.
    for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        if (t.type === type) {
            const dx = t.x - pos.x;
            const dz = t.z - pos.z;
            const sqDist = dx * dx + dz * dz;
            if (sqDist < minSqDist) {
                minSqDist = sqDist;
                nearest = { x: t.x, z: t.z };
            }
        }
    }
    return nearest;
};

export interface WalkerDecision {
    state?: 'IDLE' | 'MOVING' | 'RETURNING' | 'WORKING' | 'GATHERING';
    path?: Coordinates[];
    patrolIndex?: number;
    currentRange?: number;
    visitedTiles?: Coordinates[];
    isCalculatingPath?: boolean;
    despawn?: boolean;
    inventory?: { resource: 'wood' | 'gold'; amount: number } | null;
    resourceDrop?: { resource: 'wood' | 'gold'; amount: number };
}

/**
 * Logic for Lumberjack (Worker from Lumber Mill)
 */
const processLumberjackAI = (
    walker: GameEntity,
    home: GameEntity,
    tiles: TileData[]
): WalkerDecision | null => {
    
    // 1. If Carrying Wood -> Return Home
    if (walker.inventory && walker.inventory.amount > 0) {
        // If arrived at home
        const distToHome = Math.abs(walker.position.x - home.position.x) + Math.abs(walker.position.z - home.position.z);
        if (distToHome <= 1.5) {
             return {
                 state: 'IDLE',
                 inventory: null, // Clear inventory
                 resourceDrop: { resource: 'wood', amount: walker.inventory.amount }, // Signal store to add wood
                 path: []
             };
        }
        
        // Else ensure we are returning
        if (walker.state !== 'RETURNING') {
             return {
                 state: 'RETURNING',
                 isCalculatingPath: true
             };
        }
        return null;
    }

    // 2. If Not Carrying -> Go to Forest
    if (walker.state === 'GATHERING') {
         // Finished gathering (simulated instant for now, can be delayed in Store)
         return {
             state: 'RETURNING',
             inventory: { resource: 'wood', amount: 10 },
             isCalculatingPath: true // Calc path back home
         };
    }

    // Find Forest
    const nearestForest = findNearestTileType(walker.position, TileType.FOREST, tiles);
    
    if (nearestForest) {
        // Check if arrived at forest
        const dist = Math.abs(walker.position.x - nearestForest.x) + Math.abs(walker.position.z - nearestForest.z);
        if (dist <= 1.0) {
            return { state: 'GATHERING', path: [] }; // Start gathering
        }
        
        // Move to forest
        // Only request path if not already moving there
        if (walker.state !== 'MOVING') {
            return {
                state: 'MOVING',
                isCalculatingPath: true
            };
        }
    } else {
        // No forest? Random walk or Idle.
        return { state: 'IDLE' };
    }

    return null;
}

/**
 * Основная функция принятия решений для юнита-рабочего.
 * Вызывается, когда юнит стоит на месте (IDLE) или завершил шаг.
 */
export const processWalkerDecision = async (
  walker: GameEntity,
  parentBuilding: GameEntity | undefined,
  allEntities: GameEntity[],
  tiles: TileData[], // Added tiles for resource finding
  pathfinding: PathfindingService
): Promise<WalkerDecision | null> => {
  
  if (walker.isCalculatingPath) return null;
  if (walker.path && walker.path.length > 0) return null;

  // --- SPECIALIZED AI: LUMBERJACK ---
  if (walker.type === UnitType.WORKER && parentBuilding?.type === BuildingType.LUMBER_MILL) {
      const decision = processLumberjackAI(walker, parentBuilding, tiles);
      if (decision) return decision;
      // If logic implies a path calculation, return it so Store can execute scheduler
      if (decision !== null) return decision;
  }

  // --- GENERIC WALKER AI ---

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

// Export helper to be used in Store if needed
export { findNearestTileType };