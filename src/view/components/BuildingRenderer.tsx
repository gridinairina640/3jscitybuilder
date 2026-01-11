/**
 * @module View/BuildingRenderer
 * @layer View
 * @description Отвечает за отрисовку динамических игровых сущностей.
 * Разделяет логику для статичных зданий и анимированных юнитов.
 */

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GameEntity } from '../../shared/types';
import { BuildingType } from '../../entities/Buildings';
import { UnitType } from '../../entities/Units';
import { useGameStore } from '../../infrastructure/store/useGameStore';

interface BuildingRendererProps {
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

/**
 * Компонент для рендера одного юнита.
 * Обрабатывает интерполяцию движения (Lerp) независимо от Store.
 */
const UnitInstance: React.FC<{ entity: GameEntity, isSelected: boolean }> = ({ entity, isSelected }) => {
    const groupRef = useRef<THREE.Group>(null);
    const completeMoveStep = useGameStore(state => state.completeMoveStep);
    
    // Store current visual position to handle smooth transitions
    const visualPosition = useRef(new THREE.Vector3(entity.position.x, 0.5, entity.position.z));

    useFrame((state, delta) => {
        if (!groupRef.current) return;

        const targetX = entity.position.x;
        const targetZ = entity.position.z;
        const speed = entity.stats?.speed || 2.0;

        // If we have a path, the "visual" target is the next step in path, 
        // BUT logic hasn't updated entity.position yet.
        // Actually, the Store updates entity.position only when we call completeMoveStep.
        // So:
        // 1. If path exists, current target is path[0].
        // 2. We lerp towards path[0].
        // 3. If close, we call completeMoveStep.
        
        if (entity.path && entity.path.length > 0) {
            const nextNode = entity.path[0];
            const targetVec = new THREE.Vector3(nextNode.x, 0.5, nextNode.z);
            
            const dist = visualPosition.current.distanceTo(targetVec);
            const step = speed * delta;
            
            if (dist < step) {
                // Arrived at node
                visualPosition.current.copy(targetVec);
                completeMoveStep(entity.id);
            } else {
                // Move towards node
                const dir = targetVec.clone().sub(visualPosition.current).normalize();
                visualPosition.current.add(dir.multiplyScalar(step));
                
                // Rotation (Look at)
                groupRef.current.lookAt(targetVec.x, 0.5, targetVec.z);
            }
        } else {
            // No path, ensure we are exactly at logical position
             const logicalVec = new THREE.Vector3(entity.position.x, 0.5, entity.position.z);
             visualPosition.current.lerp(logicalVec, 10 * delta);
        }

        // Apply to Mesh
        groupRef.current.position.copy(visualPosition.current);
    });

    const color = UnitColors[entity.type as UnitType];

    return (
        <group ref={groupRef} position={[entity.position.x, 0.5, entity.position.z]}>
            {/* Unit Body */}
            <mesh position={[0, 0.2, 0]}>
                <sphereGeometry args={[0.3, 16, 16]} />
                <meshStandardMaterial color={color} />
            </mesh>

            {/* Selection Ring */}
            {isSelected && (
                <mesh position={[0, -0.4, 0]} rotation={[-Math.PI/2, 0, 0]}>
                    <ringGeometry args={[0.4, 0.45, 32]} />
                    <meshBasicMaterial color="#3b82f6" opacity={0.8} transparent />
                </mesh>
            )}

            {/* Health Bar (Only show if selected or damaged) */}
            {(isSelected || entity.health < entity.maxHealth) && (
                <group position={[0, 1.0, 0]}>
                    <mesh>
                        <planeGeometry args={[0.6, 0.08]} />
                        <meshBasicMaterial color="black" side={THREE.DoubleSide} />
                    </mesh>
                    <mesh position={[-0.3 + (0.6 * (entity.health / entity.maxHealth)) / 2, 0, 0.01]}>
                        <planeGeometry args={[0.6 * (entity.health / entity.maxHealth), 0.06]} />
                        <meshBasicMaterial color={entity.faction === 'PLAYER' ? '#22c55e' : '#ef4444'} side={THREE.DoubleSide} />
                    </mesh>
                </group>
            )}
        </group>
    );
};

export const BuildingRenderer: React.FC<BuildingRendererProps> = ({ entities }) => {
  const selectedEntityId = useGameStore(state => state.selectedEntityId);

  return (
    <group>
      {entities.map((entity) => {
        const isBuilding = Object.values(BuildingType).includes(entity.type as BuildingType);
        
        // RENDER UNITS
        if (!isBuilding) {
            return (
                <UnitInstance 
                    key={entity.id} 
                    entity={entity} 
                    isSelected={selectedEntityId === entity.id} 
                />
            );
        }

        // RENDER BUILDINGS
        const color = BuildingColors[entity.type as BuildingType];
        
        // Render Roads (Flat)
        if (entity.type === BuildingType.ROAD) {
            return (
                <mesh key={entity.id} position={[entity.position.x, 0.05, entity.position.z]} rotation={[-Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[0.9, 0.9]} />
                    <meshStandardMaterial color={color} />
                </mesh>
            )
        }
        
        // Render Structures
        return (
          <group key={entity.id} position={[entity.position.x, 0.5, entity.position.z]}>
             <mesh position={[0, 0.5, 0]}>
                <boxGeometry args={[0.6, 1, 0.6]} />
                <meshStandardMaterial color={color} />
             </mesh>
             
             {/* Health Bar for Buildings */}
            {(entity.health < entity.maxHealth) && (
                 <mesh position={[0, 1.2, 0]}>
                    <planeGeometry args={[0.6, 0.08]} />
                    <meshBasicMaterial color="red" side={THREE.DoubleSide} />
                 </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
};