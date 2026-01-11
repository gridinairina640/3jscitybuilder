import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { TileData, TileType } from '../../entities/Map';
import { GameEntity, Resources, GameEvent, Coordinates } from '../../shared/types';
import { BuildingType, BUILD_COSTS } from '../../entities/Buildings';
import { UnitType, UNIT_COSTS } from '../../entities/Units';
import { calculateTurnIncome } from '../../core/systems/EconomySystem';
import { pathfindingService } from '../../core/utils/pathfinding';

interface GameState {
  // State
  tiles: TileData[];
  entities: GameEntity[];
  resources: Resources;
  turn: number;
  lastEvent: GameEvent | null;
  selectedBuildMode: BuildingType | null;
  selectedUnitMode: UnitType | null;
  hoveredTile: Coordinates | null;
  
  // Actions
  initGame: (size: number) => void;
  setHoveredTile: (coords: Coordinates | null) => void;
  setBuildMode: (mode: BuildingType | null) => void;
  setUnitMode: (mode: UnitType | null) => void;
  setLastEvent: (event: GameEvent | null) => void;
  
  // Gameplay Actions
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
    
    // Initialize Navigation Grid
    pathfindingService.syncWithStore(initialTiles, size);

    set({
      tiles: initialTiles,
      entities: [{
        id: uuidv4(),
        type: BuildingType.HOUSE,
        position: { x: 0, z: 0 },
        health: 500,
        maxHealth: 500,
        faction: 'PLAYER'
      }]
    });
  },

  setHoveredTile: (coords) => set({ hoveredTile: coords }),
  setBuildMode: (mode) => set({ selectedBuildMode: mode, selectedUnitMode: null }),
  setUnitMode: (mode) => set({ selectedUnitMode: mode, selectedBuildMode: null }),
  setLastEvent: (event) => set({ lastEvent: event }),

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
         faction: 'PLAYER'
       };

       // Optimistic Update & Navigation Update
       // Roads = 0.5, Buildings = Obstacle
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
          faction: 'PLAYER'
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
      // 1. Check Walkability (Fast Exit)
      if (!pathfindingService.isWalkable(x, z)) {
          console.warn('Target is not walkable');
          return;
      }

      const { entities } = get();
      const unit = entities.find(e => e.id === unitId);
      if (!unit) return;

      // 2. Set Status to Calculating
      set(state => ({
          entities: state.entities.map(e => 
              e.id === unitId ? { ...e, isCalculatingPath: true } : e
          )
      }));

      // 3. Async Pathfinding
      try {
          const path = await pathfindingService.findPath(unit.position, { x, z });
          
          set(state => ({
              entities: state.entities.map(e => 
                  e.id === unitId ? { ...e, path, isCalculatingPath: false } : e
              )
          }));
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
      // 1. Move Units along their paths
      const movedEntities = state.entities.map(entity => {
          if (entity.path && entity.path.length > 0) {
              const nextStep = entity.path[0];
              const remainingPath = entity.path.slice(1);
              return {
                  ...entity,
                  position: nextStep,
                  path: remainingPath
              };
          }
          return entity;
      });

      // 2. Calculate Income
      const income = calculateTurnIncome(movedEntities);
      let newResources = {
        ...state.resources,
        wood: state.resources.wood + (income.wood || 0),
        gold: state.resources.gold + (income.gold || 0)
      };

      if (eventEffect) {
        const effectChanges = eventEffect(newResources);
        newResources = { ...newResources, ...effectChanges };
        // Ensure no negative resources
        newResources.wood = Math.max(0, newResources.wood);
        newResources.gold = Math.max(0, newResources.gold);
      }

      return {
        turn: state.turn + 1,
        resources: newResources,
        entities: movedEntities
      };
    });
  }
}));
