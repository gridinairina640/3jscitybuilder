/**
 * @module App
 * @layer Root
 * @description Точка входа в приложение. 
 * Инициализирует Canvas (R3F), освещение и управляет глобальным игровым циклом (ходы, события).
 */

import React, { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';

import { GameMap } from './src/components/GameMap';
import { UI } from './components/UI';
import { generateGameEvent } from './services/geminiService';
import { useGameStore } from './src/infrastructure/store/useGameStore';
import { Resources } from './src/shared/types';

// Initial Grid Size
const GRID_SIZE = 50;

function App() {
  const initGame = useGameStore(state => state.initGame);
  const resources = useGameStore(state => state.resources);
  const turn = useGameStore(state => state.turn);
  const lastEvent = useGameStore(state => state.lastEvent);
  const selectedBuildMode = useGameStore(state => state.selectedBuildMode);
  const selectedUnitMode = useGameStore(state => state.selectedUnitMode);
  const hoveredTile = useGameStore(state => state.hoveredTile);

  const setBuildMode = useGameStore(state => state.setBuildMode);
  const setUnitMode = useGameStore(state => state.setUnitMode);
  const setLastEvent = useGameStore(state => state.setLastEvent);
  const nextTurn = useGameStore(state => state.nextTurn);

  const [aiLoading, setAiLoading] = useState(false);

  // --- Initialization ---
  useEffect(() => {
    initGame(GRID_SIZE);
  }, [initGame]);

  // --- Turn Logic & AI ---
  const handleNextTurn = async () => {
    setAiLoading(true);
    
    // 1. Generate Event (Async)
    const event = await generateGameEvent(resources, turn, "Temperate Forest");
    setLastEvent(event);
    
    // 2. Define effect based on event
    const eventEffect = (current: Resources): Partial<Resources> => {
       if (event.severity === 'BAD') {
           return { gold: current.gold - 10, wood: current.wood - 10 };
       } else if (event.severity === 'GOOD') {
           return { gold: current.gold + 20, wood: current.wood + 20 };
       }
       return {};
    };

    // 3. Apply Turn Update (Economy + Event) via Store
    nextTurn(eventEffect);
    setAiLoading(false);
  };

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
        
        {/* Game World - Logic now inside GameMap interacting with Store */}
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
        onNextTurn={handleNextTurn}
        lastEvent={lastEvent}
        onCloseEvent={handleCloseEvent}
        isLoading={aiLoading}
      />
    </div>
  );
}

export default App;