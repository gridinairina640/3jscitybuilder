import React, { useMemo, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { TileData, TileType } from '../../entities/Map';
import { Coordinates } from '../../shared/types';

// Materials
const GrassMaterial = new THREE.MeshStandardMaterial({ color: '#4ade80' });
const ForestMaterial = new THREE.MeshStandardMaterial({ color: '#166534' });
const MountainMaterial = new THREE.MeshStandardMaterial({ color: '#78716c' });
const WaterMaterial = new THREE.MeshStandardMaterial({ color: '#3b82f6', transparent: true, opacity: 0.8 });
const BoxGeometry = new THREE.BoxGeometry(1, 1, 1);
const ConeGeometry = new THREE.ConeGeometry(0.3, 0.8, 4);
const CylinderGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.4);

interface MapTerrainProps {
  tiles: TileData[];
  onTileClick: (x: number, z: number) => void;
  setHoveredTile: (coords: Coordinates | null) => void;
}

interface InstancedLayerProps {
  tiles: TileData[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  onTileClick: (x: number, z: number) => void;
  setHoveredTile: (coords: Coordinates | null) => void;
  yOffset?: number;
  yScale?: number;
}

const InstancedLayer: React.FC<InstancedLayerProps> = ({ 
  tiles, geometry, material, onTileClick, setHoveredTile, yOffset = 0, yScale = 0.2 
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObject = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    
    tiles.forEach((tile, i) => {
      tempObject.position.set(tile.x, yOffset, tile.z);
      tempObject.scale.set(0.95, yScale, 0.95);
      tempObject.updateMatrix();
      meshRef.current!.setMatrixAt(i, tempObject.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [tiles, yOffset, yScale, tempObject]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, tiles.length]}
      onClick={(e) => {
        e.stopPropagation();
        const id = e.instanceId;
        if (id !== undefined && tiles[id]) {
            onTileClick(tiles[id].x, tiles[id].z);
        }
      }}
      onPointerMove={(e) => {
         e.stopPropagation();
         const id = e.instanceId;
         if (id !== undefined && tiles[id]) {
             setHoveredTile({ x: tiles[id].x, z: tiles[id].z });
         }
      }}
      onPointerOut={() => setHoveredTile(null)}
    />
  );
};

const TreeInstances: React.FC<{ tiles: TileData[] }> = ({ tiles }) => {
    const trunkRef = useRef<THREE.InstancedMesh>(null);
    const leavesRef = useRef<THREE.InstancedMesh>(null);
    const tempObject = useMemo(() => new THREE.Object3D(), []);
    const leavesMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#064e3b" }), []);
    const trunkMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#451a03" }), []);

    useLayoutEffect(() => {
        if (!trunkRef.current || !leavesRef.current) return;

        tiles.forEach((tile, i) => {
            // Trunk
            tempObject.position.set(tile.x, 0.3, tile.z); 
            tempObject.scale.set(1, 1, 1);
            tempObject.updateMatrix();
            trunkRef.current!.setMatrixAt(i, tempObject.matrix);

            // Leaves
            tempObject.position.set(tile.x, 0.7, tile.z);
            tempObject.scale.set(1, 1, 1);
            tempObject.updateMatrix();
            leavesRef.current!.setMatrixAt(i, tempObject.matrix);
        });
        trunkRef.current.instanceMatrix.needsUpdate = true;
        leavesRef.current.instanceMatrix.needsUpdate = true;
    }, [tiles, tempObject]);

    return (
        <group>
            <instancedMesh ref={trunkRef} args={[CylinderGeometry, trunkMaterial, tiles.length]} />
            <instancedMesh ref={leavesRef} args={[ConeGeometry, leavesMaterial, tiles.length]} />
        </group>
    );
}

export const MapTerrain: React.FC<MapTerrainProps> = ({ tiles, onTileClick, setHoveredTile }) => {
  const grassTiles = useMemo(() => tiles.filter(t => t.type === TileType.GRASS), [tiles]);
  const forestTiles = useMemo(() => tiles.filter(t => t.type === TileType.FOREST), [tiles]);
  const mountainTiles = useMemo(() => tiles.filter(t => t.type === TileType.MOUNTAIN), [tiles]);
  const waterTiles = useMemo(() => tiles.filter(t => t.type === TileType.WATER), [tiles]);

  return (
    <group>
      <InstancedLayer tiles={grassTiles} geometry={BoxGeometry} material={GrassMaterial} onTileClick={onTileClick} setHoveredTile={setHoveredTile} />
      <InstancedLayer tiles={forestTiles} geometry={BoxGeometry} material={ForestMaterial} onTileClick={onTileClick} setHoveredTile={setHoveredTile} />
      <InstancedLayer tiles={mountainTiles} geometry={BoxGeometry} material={MountainMaterial} onTileClick={onTileClick} setHoveredTile={setHoveredTile} yOffset={0.5} yScale={2} />
      <InstancedLayer tiles={waterTiles} geometry={BoxGeometry} material={WaterMaterial} onTileClick={onTileClick} setHoveredTile={setHoveredTile} yOffset={-0.2} yScale={0.2} />
      <TreeInstances tiles={forestTiles} />
    </group>
  );
};
