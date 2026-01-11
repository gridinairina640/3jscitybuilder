/**
 * @module Components/GameMap
 * @layer View
 * @description Корневой компонент 3D-сцены.
 * Связывает Zustand Store с визуальными компонентами (MapTerrain, BuildingRenderer).
 * Обрабатывает пользовательский ввод в 3D пространстве.
 */

import React from 'react';
import * as THREE from 'three';
import { useGameStore } from '../src/infrastructure/store/useGameStore';
import { MapTerrain } from '../src/view/components/MapTerrain';
import { BuildingRenderer } from '../src/view/components/BuildingRenderer';

export const GameMap: React.FC = () => {
  const tiles = useGameStore(state => state.tiles);
  const entities = useGameStore(state => state.entities);
  const hoveredTile = useGameStore(state => state.hoveredTile);
  const selectedBuildMode = useGameStore(state => state.selectedBuildMode);
  const selectedUnitMode = useGameStore(state => state.selectedUnitMode);
  
  const setHoveredTile = useGameStore(state => state.setHoveredTile);
  const buildEntity = useGameStore(state => state.buildEntity);
  const recruitUnit = useGameStore(state => state.recruitUnit);

  const handleTileClick = (x: number, z: number) => {
    if (selectedBuildMode) {
        buildEntity(x, z);
    } else if (selectedUnitMode) {
        recruitUnit(x, z);
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

      {/* Hover Indicator */}
      {hoveredTile && (
        <group position={[hoveredTile.x, 0.51, hoveredTile.z]}>
            <mesh>
                <ringGeometry args={[0.3, 0.4, 32]} />
                <meshBasicMaterial color="white" opacity={0.8} transparent side={THREE.DoubleSide} />
            </mesh>
            {/* Helper box */}
            <mesh position={[0, -0.51, 0]}> 
               <boxGeometry args={[1, 1.1, 1]} />
               <meshStandardMaterial color="white" wireframe opacity={0.2} transparent />
            </mesh>
        </group>
      )}
    </group>
  );
};