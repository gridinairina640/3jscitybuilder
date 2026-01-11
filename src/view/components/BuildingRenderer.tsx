/**
 * @module View/BuildingRenderer
 * @layer View
 * @description Отвечает за отрисовку динамических игровых сущностей (зданий, юнитов).
 * В отличие от террейна, здесь используется обычный Mesh, так как объекты меняются часто.
 */

import React from 'react';
import * as THREE from 'three';
import { GameEntity } from '../../shared/types';
import { BuildingType } from '../../entities/Buildings';
import { UnitType } from '../../entities/Units';

interface BuildingRendererProps {
  /** Список всех активных сущностей для рендера */
  entities: GameEntity[];
}

const BuildingColors: Record<BuildingType, string> = {
  [BuildingType.HOUSE]: '#ea580c',
  [BuildingType.LUMBER_MILL]: '#854d0e',
  [BuildingType.BARRACKS]: '#991b1b',
  [BuildingType.TOWER]: '#525252',
  [BuildingType.ROAD]: '#d6d3d1'
};

const UnitColors: Record<UnitType, string> = {
  [UnitType.WORKER]: '#fde047',
  [UnitType.SOLDIER]: '#1e40af',
  [UnitType.HERO]: '#a855f7',
};

export const BuildingRenderer: React.FC<BuildingRendererProps> = ({ entities }) => {
  return (
    <group>
      {entities.map((entity) => {
        const isBuilding = Object.values(BuildingType).includes(entity.type as BuildingType);
        const color = isBuilding 
            ? BuildingColors[entity.type as BuildingType] 
            : UnitColors[entity.type as UnitType];
            
        // Render Roads differently (flat)
        if (entity.type === BuildingType.ROAD) {
            return (
                <mesh key={entity.id} position={[entity.position.x, 0.05, entity.position.z]} rotation={[-Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[0.9, 0.9]} />
                    <meshStandardMaterial color={color} />
                </mesh>
            )
        }
        
        return (
          <group key={entity.id} position={[entity.position.x, 0.5, entity.position.z]}>
            {isBuilding ? (
                 <mesh position={[0, 0.5, 0]}>
                    <boxGeometry args={[0.6, 1, 0.6]} />
                    <meshStandardMaterial color={color} />
                 </mesh>
            ) : (
                <mesh position={[0, 0.2, 0]}>
                    <sphereGeometry args={[0.3, 16, 16]} />
                    <meshStandardMaterial color={color} />
                </mesh>
            )}
            
            {/* Health Bar */}
            <mesh position={[0, 1.2, 0]}>
                <planeGeometry args={[0.8, 0.1]} />
                <meshBasicMaterial color="black" side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[-0.4 + (0.8 * (entity.health / entity.maxHealth)) / 2, 1.2, 0.01]}>
                <planeGeometry args={[0.8 * (entity.health / entity.maxHealth), 0.08]} />
                <meshBasicMaterial color={entity.faction === 'PLAYER' ? 'green' : 'red'} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
};