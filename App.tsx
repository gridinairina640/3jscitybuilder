/**
 * @module App
 * @layer Root
 * @description Точка входа в приложение. 
 * Инициализирует Canvas (R3F), освещение и управляет глобальным игровым циклом (ходы, события).
 */

import React, { useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';

import { GameMap } from './src/components/GameMap';
import { UI } from './components/UI';
import { useGameStore } from './src/infrastructure/store/useGameStore';

// Initial Grid Size
const GRID_SIZE = 50;

// Game Loop Configuration
const TICK_RATE_MS = 5000; // 5 seconds = 1 Month (Global Tick)

function App() {
  const initGame = useGameStore(state => state.initGame);
  const resources = useGameStore(state => state.resources);
  const turn = useGameStore(state => state.turn);
  const isPlaying = useGameStore(state => state.isPlaying);
  const lastEvent = useGameStore(state => state.lastEvent);
  const selectedBuildMode = useGameStore(state => state.selectedBuildMode);
  const selectedUnitMode = useGameStore(state => state.selectedUnitMode);
  const hoveredTile = useGameStore(state => state.hoveredTile);

  const setBuildMode = useGameStore(state => state.setBuildMode);
  const setUnitMode = useGameStore(state => state.setUnitMode);
  const setLastEvent = useGameStore(state => state.setLastEvent);
  const togglePause = useGameStore(state => state.togglePause);
  
  const tick = useGameStore(state => state.tick);

  const turnRef = useRef(turn); // Ref to access current turn inside closure

  // Sync ref
  useEffect(() => { turnRef.current = turn; }, [turn]);

  // --- Initialization ---
  useEffect(() => {
    initGame(GRID_SIZE);
  }, [initGame]);

  // --- Real-time Game Loop ---
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
        // 1. Advance Economy (Passive Income)
        tick();
    }, TICK_RATE_MS);

    return () => clearInterval(interval);
  }, [isPlaying, tick]);

  const handleCloseEvent = () => {
    setLastEvent(null);
  };

  return (
    <div className="h-full w-full bg-slate-900 relative">
      <Canvas shadows camera={{ position: [20, 20, 20], fov: 45 }}>
        <color attach="background" args={['#1e1b4b']} />
        
        {/* Environment */}
        <OrbitControls makeDefault minDistance={5} maxDistance={80} target={[0, 0, 0]} />
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
        <ambientLight intensity={0.5} />
        <directionalLight 
            position={[10, 20, 5]} 
            intensity={1.5} 
            castShadow 
            shadow-mapSize={[1024, 1024]} 
        />
        
        {/* Game World */}
        <GameMap />
        
        {/* Visual Cursors */}
        {hoveredTile && (selectedBuildMode || selectedUnitMode) && (
            <mesh position={[hoveredTile.x, 0.5, hoveredTile.z]}>
                <boxGeometry args={[0.8, 0.8, 0.8]} />
                <meshStandardMaterial 
                    color={selectedBuildMode ? "orange" : "blue"} 
                    transparent 
                    opacity={0.4} 
                />
            </mesh>
        )}
      </Canvas>

      <UI 
        resources={resources}
        selectedBuildMode={selectedBuildMode}
        setBuildMode={setBuildMode}
        selectedUnitMode={selectedUnitMode}
        setUnitMode={setUnitMode}
        turn={turn}
        isPlaying={isPlaying}
        onTogglePause={togglePause}
        lastEvent={lastEvent}
        onCloseEvent={handleCloseEvent}
      />
    </div>
  );
}

export default App;