/**
 * @module Infrastructure/Store
 * @layer Infrastructure
 * @description Центральное хранилище состояния (Single Source of Truth).
 * Реализовано на Zustand. Связывает Actions с Core Logic.
 */

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { TileData, TileType } from '../../entities/Map';
import { GameEntity, Resources, GameEvent, Coordinates } from '../../shared/types';
import { BuildingType, BUILD_COSTS } from '../../entities/Buildings';
import { UnitType, UNIT_COSTS, UNIT_STATS } from '../../entities/Units';
import { calculateTurnIncome } from '../../core/systems/EconomySystem';
import { pathfindingService } from '../../core/utils/pathfinding';
import { pathfindingScheduler, Priority } from '../../core/utils/pathfindingScheduler';
import { processWalkerDecision, findNearestTileType } from '../../core/systems/WalkerSystem';

interface GameState {
  // --- State ---
  tiles: TileData[];
  entities: GameEntity[];
  resources: Resources;
  turn: number;
  lastEvent: GameEvent | null;
  
  // Controls & Modes
  selectedBuildMode: BuildingType | null;
  selectedUnitMode: UnitType | null;
  hoveredTile: Coordinates | null;
  selectedEntityId: string | null;
  
  // --- Actions ---
  initGame: (size: number) => void;
  setHoveredTile: (coords: Coordinates | null) => void;
  setBuildMode: (mode: BuildingType | null) => void;
  setUnitMode: (mode: UnitType | null) => void;
  setLastEvent: (event: GameEvent | null) => void;
  
  // --- RTS Interactions ---
  selectEntity: (id: string | null) => void;
  
  /**
   * Вызывается View-слоем, когда юнит визуально завершил перемещение на один тайл.
   * Обновляет логическую позицию юнита в сетке и запускает AI следующего шага.
   */
  completeMoveStep: (unitId: string) => Promise<void>;
  
  // --- Gameplay Actions ---
  buildEntity: (x: number, z: number) => void;
  recruitUnit: (x: number, z: number) => Promise<void>;
  setUnitTarget: (unitId: string, x: number, z: number) => Promise<void>;
  nextTurn: (eventEffect?: (current: Resources) => Partial<Resources>) => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  // Initial State
  tiles: [],
  entities: [],
  resources: { wood: 100, stone: 50, gold: 50, population: 0, populationCap: 5 },
  turn: 1,
  lastEvent: null,
  
  selectedBuildMode: null,
  selectedUnitMode: null,
  hoveredTile: null,
  selectedEntityId: null,

  // Actions
  initGame: (size: number) => {
    const initialTiles: TileData[] = [];
    for (let x = -size/2; x < size/2; x++) {
      for (let z = -size/2; z < size/2; z++) {
        let type = TileType.GRASS;
        const noise = Math.sin(x * 0.5) + Math.cos(z * 0.5);
        if (noise > 1) type = TileType.FOREST;
        if (noise < -1) type = TileType.WATER;
        if (Math.random() > 0.95) type = TileType.MOUNTAIN;

        initialTiles.push({
          id: uuidv4(),
          x,
          z,
          type,
          height: 0,
          occupiedBy: null
        });
      }
    }
    
    pathfindingService.syncWithStore(initialTiles, size);

    set({
      tiles: initialTiles,
      entities: [{
        id: uuidv4(),
        type: BuildingType.HOUSE,
        position: { x: 0, z: 0 },
        health: 500,
        maxHealth: 500,
        faction: 'PLAYER',
        state: 'IDLE'
      }]
    });
  },

  setHoveredTile: (coords) => set({ hoveredTile: coords }),
  setBuildMode: (mode) => set({ selectedBuildMode: mode, selectedUnitMode: null, selectedEntityId: null }),
  setUnitMode: (mode) => set({ selectedUnitMode: mode, selectedBuildMode: null, selectedEntityId: null }),
  setLastEvent: (event) => set({ lastEvent: event }),
  
  selectEntity: (id) => set({ 
    selectedEntityId: id, 
    selectedBuildMode: null, 
    selectedUnitMode: null 
  }),

  completeMoveStep: async (unitId) => {
    // 1. Update Position (Synchronous)
    set(state => ({
      entities: state.entities.map(e => {
        if (e.id !== unitId || !e.path || e.path.length === 0) return e;

        const nextPos = e.path[0];
        const remainingPath = e.path.slice(1);
        const newState = remainingPath.length === 0 ? 'IDLE' : 'MOVING';

        return {
          ...e,
          position: nextPos,
          path: remainingPath,
          state: newState
        };
      })
    }));

    // 2. Walker AI Decision (Autonomous Behavior)
    const state = get();
    const unit = state.entities.find(e => e.id === unitId);
    
    // Only process AI for units that are Idle or Just Finished Step (and are not moving)
    if (!unit || unit.faction !== 'PLAYER' || (unit.path && unit.path.length > 0)) return;
    
    // Identify Parent
    const parentBuilding = unit.homeId 
        ? state.entities.find(e => e.id === unit.homeId)
        : undefined;

    const decision = await processWalkerDecision(unit, parentBuilding, state.entities, state.tiles, pathfindingService);
    
    if (!decision) return;

    // Apply Decision State Updates
    set(s => ({
        entities: s.entities.map(e => e.id === unitId ? { ...e, ...decision } : e)
    }));
    
    // Apply Resource Drops (Economy Update)
    if (decision.resourceDrop) {
        set(s => ({
            resources: {
                ...s.resources,
                [decision.resourceDrop!.resource]: s.resources[decision.resourceDrop!.resource] + decision.resourceDrop!.amount
            }
        }));
    }

    // If decision involves complex pathfinding (Return Home / Patrol to Waypoint / Go to Resource)
    if (decision.isCalculatingPath) {
        let target: Coordinates | undefined;
        
        // Target Logic
        if (decision.state === 'RETURNING' && parentBuilding) {
            target = parentBuilding.position;
        } else if (parentBuilding?.patrolPath && decision.patrolIndex !== undefined) {
            target = parentBuilding.patrolPath[decision.patrolIndex];
        } else if (decision.state === 'MOVING' && unit.type === UnitType.WORKER && parentBuilding?.type === BuildingType.LUMBER_MILL) {
             // Lumberjack looking for forest
             const nearestForest = findNearestTileType(unit.position, TileType.FOREST, state.tiles);
             if (nearestForest) target = nearestForest;
        }

        if (target) {
            try {
                // We use LOW priority for ambient walkers to not clog the queue
                const result = await pathfindingScheduler.requestPath(
                    unit.position,
                    target,
                    Priority.LOW, 
                    { failToClosest: true }
                );

                if (result.status === 'success' || result.status === 'partial_path') {
                     set(s => ({
                        entities: s.entities.map(e => e.id === unitId ? {
                            ...e,
                            path: result.path,
                            state: decision.state || 'MOVING',
                            isCalculatingPath: false
                        } : e)
                    }));
                } else {
                     // Path failed, go IDLE
                     set(s => ({
                        entities: s.entities.map(e => e.id === unitId ? { ...e, state: 'IDLE', isCalculatingPath: false } : e)
                    }));
                }
            } catch (e) {
                console.warn("Walker path failed", e);
                set(s => ({
                    entities: s.entities.map(e => e.id === unitId ? { ...e, isCalculatingPath: false } : e)
                }));
            }
        }
    }
  },

  buildEntity: (x, z) => {
    const { tiles, selectedBuildMode, resources } = get();
    if (!selectedBuildMode) return;

    const tile = tiles.find(t => t.x === x && t.z === z);
    if (!tile || tile.occupiedBy || tile.type === TileType.WATER || tile.type === TileType.MOUNTAIN) return;

    const cost = BUILD_COSTS[selectedBuildMode];
    if (resources.wood >= (cost.wood || 0) && resources.stone >= (cost.stone || 0) && resources.gold >= (cost.gold || 0)) {
       const newEntity: GameEntity = {
         id: uuidv4(),
         type: selectedBuildMode,
         position: { x, z },
         health: 100,
         maxHealth: 100,
         faction: 'PLAYER',
         state: 'IDLE'
       };

       const navType = selectedBuildMode === BuildingType.ROAD ? 'ROAD' : 'BUILDING';
       pathfindingService.updateNode(x, z, navType);

       set(state => ({
         resources: {
           ...state.resources,
           wood: state.resources.wood - (cost.wood || 0),
           stone: state.resources.stone - (cost.stone || 0),
           gold: state.resources.gold - (cost.gold || 0),
           populationCap: selectedBuildMode === BuildingType.HOUSE ? state.resources.populationCap + 5 : state.resources.populationCap
         },
         entities: [...state.entities, newEntity],
         tiles: state.tiles.map(t => t.id === tile.id ? { ...t, occupiedBy: newEntity.id } : t),
         selectedBuildMode: null
       }));
    }
  },

  recruitUnit: async (x, z) => {
    const { tiles, selectedUnitMode, resources, entities } = get();
    if (!selectedUnitMode) return;

    const tile = tiles.find(t => t.x === x && t.z === z);
    if (!tile || tile.occupiedBy || tile.type === TileType.WATER || tile.type === TileType.MOUNTAIN) return;

    const cost = UNIT_COSTS[selectedUnitMode];
    if (resources.gold >= (cost.gold || 0) && resources.wood >= (cost.wood || 0) && resources.population < resources.populationCap) {
       
       const unitId = uuidv4();

       // 1. Identify Home (Building at spawn location)
       const homeBuilding = entities.find(e => 
            Math.round(e.position.x) === x && 
            Math.round(e.position.z) === z &&
            Object.values(BuildingType).includes(e.type as BuildingType)
       );

       // 2. Initial Setup
       const newEntity: GameEntity = {
          id: unitId,
          type: selectedUnitMode,
          position: { x, z },
          health: selectedUnitMode === UnitType.HERO ? 200 : 50,
          maxHealth: selectedUnitMode === UnitType.HERO ? 200 : 50,
          faction: 'PLAYER',
          state: 'IDLE',
          stats: UNIT_STATS[selectedUnitMode],
          homeId: homeBuilding?.id,
          // Walker Stats
          maxRange: 50,
          currentRange: 50,
          visitedTiles: []
       };

       // 3. Commit Spawn (Synchronous part)
       set(state => ({
          resources: {
            ...state.resources,
            wood: state.resources.wood - (cost.wood || 0),
            gold: state.resources.gold - (cost.gold || 0),
            population: state.resources.population + 1
          },
          entities: [...state.entities, newEntity],
          selectedUnitMode: null
       }));
       
       // Trigger initial logic
       setTimeout(() => get().completeMoveStep(unitId), 100);
    }
  },

  setUnitTarget: async (unitId: string, x: number, z: number) => {
      const { entities } = get();
      const unit = entities.find(e => e.id === unitId);
      if (!unit) return;

      set(state => ({
          entities: state.entities.map(e => 
              e.id === unitId ? { ...e, isCalculatingPath: true, state: 'MOVING' } : e
          )
      }));

      try {
          // Use Scheduler with HIGH priority for direct user commands
          const result = await pathfindingScheduler.requestPath(
              unit.position, 
              { x, z }, 
              Priority.HIGH,
              { failToClosest: true }
          );
          
          if (result.status === 'success' || result.status === 'partial_path') {
            set(state => ({
                entities: state.entities.map(e => 
                    e.id === unitId ? { 
                        ...e, 
                        path: result.path, 
                        isCalculatingPath: false,
                        state: 'MOVING',
                        // Reset walker state on manual command
                        currentRange: 50,
                        visitedTiles: []
                    } : e
                )
            }));
          } else {
             set(state => ({
                entities: state.entities.map(e => 
                    e.id === unitId ? { ...e, isCalculatingPath: false } : e
                )
            }));
          }
      } catch (error) {
          console.error("Pathfinding error", error);
          set(state => ({
              entities: state.entities.map(e => 
                  e.id === unitId ? { ...e, isCalculatingPath: false } : e
              )
          }));
      }
  },

  nextTurn: (eventEffect) => {
    set(state => {
      const income = calculateTurnIncome(state.entities);
      let newResources = {
        ...state.resources,
        wood: state.resources.wood + (income.wood || 0),
        gold: state.resources.gold + (income.gold || 0)
      };

      if (eventEffect) {
        const effectChanges = eventEffect(newResources);
        newResources = { ...newResources, ...effectChanges };
        newResources.wood = Math.max(0, newResources.wood);
        newResources.gold = Math.max(0, newResources.gold);
      }

      return {
        turn: state.turn + 1,
        resources: newResources
      };
    });
  }
}));