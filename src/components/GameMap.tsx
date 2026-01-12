/**
 * @module Components/GameMap
 * @layer View
 * @description Корневой компонент 3D-сцены.
 * Связывает Zustand Store с визуальными компонентами (MapTerrain, BuildingRenderer).
 * Обрабатывает пользовательский ввод в 3D пространстве.
 */

import React from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../infrastructure/store/useGameStore';
import { MapTerrain } from '../view/components/MapTerrain';
import { BuildingRenderer } from '../view/components/BuildingRenderer';
import { pathfindingScheduler } from '../core/utils/pathfindingScheduler';

export const GameMap: React.FC = () => {
  const tiles = useGameStore(state => state.tiles);
  const entities = useGameStore(state => state.entities);
  const hoveredTile = useGameStore(state => state.hoveredTile);
  const selectedBuildMode = useGameStore(state => state.selectedBuildMode);
  const selectedUnitMode = useGameStore(state => state.selectedUnitMode);
  const selectedEntityId = useGameStore(state => state.selectedEntityId);
  
  const setHoveredTile = useGameStore(state => state.setHoveredTile);
  const buildEntity = useGameStore(state => state.buildEntity);
  const recruitUnit = useGameStore(state => state.recruitUnit);
  const selectEntity = useGameStore(state => state.selectEntity);
  const setUnitTarget = useGameStore(state => state.setUnitTarget);

  // --- Scheduler Integration ---
  // Process pathfinding queue every frame with a 2ms budget.
  // This keeps the UI responsive even with many units requesting paths.
  useFrame(() => {
    pathfindingScheduler.tick(2);
  });

  const handleTileClick = (x: number, z: number) => {
    // 1. Build Mode
    if (selectedBuildMode) {
        buildEntity(x, z);
        return;
    }
    
    // 2. Recruit Mode
    if (selectedUnitMode) {
        recruitUnit(x, z);
        return;
    }

    // 3. Unit Interaction
    const clickedEntity = entities.find(e => e.position.x === x && e.position.z === z);

    if (clickedEntity) {
        // Select Unit
        selectEntity(clickedEntity.id);
    } else {
        // Empty Tile Click
        if (selectedEntityId) {
            // Move Command for selected unit
            setUnitTarget(selectedEntityId, x, z);
            // Optional: Create visual feedback marker here
        } else {
            // Deselect if clicking empty ground with nothing selected
            selectEntity(null);
        }
    }
  };

  return (
    <group>
      <MapTerrain 
        tiles={tiles} 
        onTileClick={handleTileClick} 
        setHoveredTile={setHoveredTile} 
      />
      
      <BuildingRenderer entities={entities} />

      {/* Cursor / Selection Indicators */}
      {hoveredTile && (
        <group position={[hoveredTile.x, 0, hoveredTile.z]}>
            {/* Generic Hover Cursor */}
             <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.35, 0.4, 32]} />
                <meshBasicMaterial color="white" opacity={0.4} transparent />
            </mesh>

            {/* Build Preview */}
            {(selectedBuildMode || selectedUnitMode) && (
               <mesh position={[0, 0.5, 0]}>
                   <boxGeometry args={[0.8, 0.8, 0.8]} />
                   <meshStandardMaterial 
                       color={selectedBuildMode ? "orange" : "blue"} 
                       transparent 
                       opacity={0.4} 
                   />
               </mesh>
            )}
        </group>
      )}
    </group>
  );
};