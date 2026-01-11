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
   * Обновляет логическую позицию юнита в сетке.
   */
  completeMoveStep: (unitId: string) => void;
  
  // --- Gameplay Actions ---
  buildEntity: (x: number, z: number) => void;
  recruitUnit: (x: number, z: number) => void;
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

  completeMoveStep: (unitId) => {
    set(state => ({
      entities: state.entities.map(e => {
        if (e.id !== unitId || !e.path || e.path.length === 0) return e;

        // Unit arrived at path[0].
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

  recruitUnit: (x, z) => {
    const { tiles, selectedUnitMode, resources } = get();
    if (!selectedUnitMode) return;

    const tile = tiles.find(t => t.x === x && t.z === z);
    if (!tile || tile.occupiedBy || tile.type === TileType.WATER || tile.type === TileType.MOUNTAIN) return;

    const cost = UNIT_COSTS[selectedUnitMode];
    if (resources.gold >= (cost.gold || 0) && resources.wood >= (cost.wood || 0) && resources.population < resources.populationCap) {
       const newEntity: GameEntity = {
          id: uuidv4(),
          type: selectedUnitMode,
          position: { x, z },
          health: selectedUnitMode === UnitType.HERO ? 200 : 50,
          maxHealth: selectedUnitMode === UnitType.HERO ? 200 : 50,
          faction: 'PLAYER',
          state: 'IDLE',
          stats: UNIT_STATS[selectedUnitMode]
       };

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
    }
  },

  setUnitTarget: async (unitId: string, x: number, z: number) => {
      // NOTE: We don't check isWalkable here anymore because findPath
      // with failToClosest: true handles unreachable targets.
      
      const { entities } = get();
      const unit = entities.find(e => e.id === unitId);
      if (!unit) return;

      set(state => ({
          entities: state.entities.map(e => 
              e.id === unitId ? { ...e, isCalculatingPath: true } : e
          )
      }));

      try {
          // Enable failToClosest for better UX (RTS style movement)
          const result = await pathfindingService.findPath(
              unit.position, 
              { x, z }, 
              { failToClosest: true }
          );
          
          if (result.status === 'success' || result.status === 'partial_path') {
            set(state => ({
                entities: state.entities.map(e => 
                    e.id === unitId ? { 
                        ...e, 
                        path: result.path, 
                        isCalculatingPath: false,
                        state: 'MOVING' 
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
      // Note: Movement is now Real-time, handled by completeMoveStep and View layer.
      // nextTurn only handles Economy and Events (Seasons).
      
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
