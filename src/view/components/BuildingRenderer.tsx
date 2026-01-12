/**
 * @module View/BuildingRenderer
 * @layer View
 * @description Orchestrates the rendering of all game entities.
 * - Uses InstancedMesh for static buildings and roads (GPU Optimization).
 * - Uses Individual Meshes for animated units with smooth interpolation.
 * - STRICTLY READ-ONLY: Does not trigger Store actions.
 */

import React, { useRef, useMemo, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { GameEntity } from '../../shared/types';
import { BuildingType } from '../../entities/Buildings';
import { UnitType } from '../../entities/Units';
import { useGameStore } from '../../infrastructure/store/useGameStore';

// --- Assets & Constants ---

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

// Reusable Geometries to reduce memory overhead
const BoxGeo = new THREE.BoxGeometry(0.6, 1, 0.6);
const RoadGeo = new THREE.PlaneGeometry(0.9, 0.9);
const UnitGeo = new THREE.SphereGeometry(0.3, 16, 16);

// --- Instanced Renderers (Static Objects) ---

interface InstancedLayerProps {
  type: BuildingType;
  entities: GameEntity[];
}

const RoadRenderer: React.FC<{ entities: GameEntity[] }> = ({ entities }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const roadEntities = useMemo(() => entities.filter(e => e.type === BuildingType.ROAD), [entities]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: BuildingColors[BuildingType.ROAD] }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    
    roadEntities.forEach((entity, i) => {
      dummy.position.set(entity.position.x, 0.05, entity.position.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [roadEntities, dummy]);

  if (roadEntities.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[RoadGeo, material, roadEntities.length]} />
  );
};

const BuildingLayer: React.FC<InstancedLayerProps> = ({ type, entities }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const filtered = useMemo(() => entities.filter(e => e.type === type), [entities, type]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: BuildingColors[type] }), [type]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    if (!meshRef.current) return;

    filtered.forEach((entity, i) => {
      dummy.position.set(entity.position.x, 0.5, entity.position.z);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [filtered, dummy]);

  if (filtered.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[BoxGeo, material, filtered.length]} />
  );
};

// --- Dynamic Unit Renderer (Animated) ---

const UnitInstance: React.FC<{ entity: GameEntity, isSelected: boolean }> = ({ entity, isSelected }) => {
  const groupRef = useRef<THREE.Group>(null);
  const color = UnitColors[entity.type as UnitType];
  
  // Refs for interpolation state
  // We use refs to avoid re-renders during the animation frame
  const visualPos = useRef(new THREE.Vector3(entity.position.x, 0.5, entity.position.z));
  const visualRot = useRef(new THREE.Quaternion());
  const targetRot = useRef(new THREE.Quaternion());

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    // 1. Position Interpolation (Lerp)
    // The visual layer blindly follows the logical position from the Store.
    // It does NOT drive the logic (read-only).
    const targetPos = new THREE.Vector3(entity.position.x, 0.5, entity.position.z);
    
    // Smoothness factor (Higher = snappier, Lower = smoother)
    const lerpFactor = 10 * delta; 
    visualPos.current.lerp(targetPos, lerpFactor);
    groupRef.current.position.copy(visualPos.current);

    // 2. Rotation Interpolation (Slerp)
    // Calculate look-at quaternion
    if (visualPos.current.distanceToSquared(targetPos) > 0.001) {
      const dummy = new THREE.Object3D();
      dummy.position.copy(visualPos.current);
      dummy.lookAt(targetPos);
      targetRot.current.copy(dummy.quaternion);
      
      const rotSpeed = 8 * delta;
      visualRot.current.slerp(targetRot.current, rotSpeed);
      groupRef.current.quaternion.copy(visualRot.current);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Unit Mesh */}
      <mesh position={[0, 0.2, 0]} geometry={UnitGeo}>
        <meshStandardMaterial color={color} />
      </mesh>

      {/* Floating UI Elements (Billboards) */}
      <Billboard position={[0, 1.2, 0]}>
        {/* Inventory Indicator */}
        {entity.inventory && entity.inventory.amount > 0 && (
          <mesh position={[0, 0.4, 0]}>
             <boxGeometry args={[0.3, 0.3, 0.3]} />
             <meshStandardMaterial color={entity.inventory.resource === 'wood' ? '#5D4037' : '#FFD700'} />
          </mesh>
        )}

        {/* Health Bar (Show if damaged or selected) */}
        {(isSelected || entity.health < entity.maxHealth) && (
          <group position={[0, 0, 0]}>
            <mesh>
              <planeGeometry args={[0.8, 0.1]} />
              <meshBasicMaterial color="black" />
            </mesh>
            <mesh position={[-0.4 + (0.8 * (entity.health / entity.maxHealth)) / 2, 0, 0.01]}>
              <planeGeometry args={[0.8 * (entity.health / entity.maxHealth), 0.08]} />
              <meshBasicMaterial color={entity.faction === 'PLAYER' ? '#22c55e' : '#ef4444'} />
            </mesh>
          </group>
        )}
      </Billboard>

      {/* Selection Ring (Ground Level) */}
      {isSelected && (
        <mesh position={[0, -0.45, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.4, 0.45, 32]} />
          <meshBasicMaterial color="#3b82f6" opacity={0.8} transparent />
        </mesh>
      )}
    </group>
  );
};

// --- Main Controller ---

export const BuildingRenderer: React.FC<{ entities: GameEntity[] }> = ({ entities }) => {
  const selectedEntityId = useGameStore(state => state.selectedEntityId);

  // Filter entities for Instancing
  // Note: We reconstruct these arrays on render. For 10k+ objects, use memoization with deep compare 
  // or a specialized store selector, but for <1000 objects this is fine.
  
  const units = entities.filter(e => Object.values(UnitType).includes(e.type as UnitType));
  
  // Collect damaged buildings for non-instanced UI rendering
  const damagedBuildings = entities.filter(e => 
    !Object.values(UnitType).includes(e.type as UnitType) && 
    e.health < e.maxHealth
  );

  return (
    <group>
      {/* 1. Static Geometry (Instanced) */}
      <RoadRenderer entities={entities} />
      
      {Object.values(BuildingType).map((type) => {
        if (type === BuildingType.ROAD) return null;
        return <BuildingLayer key={type} type={type} entities={entities} />;
      })}

      {/* 2. Dynamic Units (Individual Meshes with Interpolation) */}
      {units.map(unit => (
        <UnitInstance 
          key={unit.id} 
          entity={unit} 
          isSelected={selectedEntityId === unit.id} 
        />
      ))}

      {/* 3. Status Overlays for Damaged Buildings (Billboards) */}
      {damagedBuildings.map(b => (
          <Billboard key={`hp-${b.id}`} position={[b.position.x, 1.5, b.position.z]}>
              <mesh>
                  <planeGeometry args={[0.8, 0.1]} />
                  <meshBasicMaterial color="black" />
              </mesh>
              <mesh position={[-0.4 + (0.8 * (b.health / b.maxHealth)) / 2, 0, 0.01]}>
                  <planeGeometry args={[0.8 * (b.health / b.maxHealth), 0.08]} />
                  <meshBasicMaterial color="red" />
              </mesh>
          </Billboard>
      ))}
    </group>
  );
};