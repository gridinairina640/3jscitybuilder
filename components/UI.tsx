/**
 * @module Components/UI
 * @layer View
 * @description Отвечает за 2D HUD интерфейс.
 * Отображает ресурсы, панели строительства/найма и модальные окна событий.
 */

import React from 'react';
import { Resources, GameEvent } from '../src/shared/types';
import { BuildingType, BUILD_COSTS } from '../src/entities/Buildings';
import { UnitType, UNIT_COSTS } from '../src/entities/Units';
import { Sword, Hammer, Trees, Gem, Users, HardHat, Play, Pause, X } from 'lucide-react';

interface UIProps {
  resources: Resources;
  selectedBuildMode: BuildingType | null;
  setBuildMode: (type: BuildingType | null) => void;
  selectedUnitMode: UnitType | null;
  setUnitMode: (type: UnitType | null) => void;
  turn: number;
  isPlaying: boolean;
  onTogglePause: () => void;
  lastEvent: GameEvent | null;
  onCloseEvent: () => void;
}

export const UI: React.FC<UIProps> = ({
  resources,
  selectedBuildMode,
  setBuildMode,
  selectedUnitMode,
  setUnitMode,
  turn,
  isPlaying,
  onTogglePause,
  lastEvent,
  onCloseEvent
}) => {
  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 z-10">
      {/* Top Bar: Resources */}
      <div className="flex justify-between items-start">
        <div className="bg-slate-900/90 backdrop-blur-md p-3 rounded-xl border border-slate-700 text-slate-100 flex gap-6 shadow-xl pointer-events-auto">
          <div className="flex items-center gap-2">
            <Trees className="w-5 h-5 text-emerald-400" />
            <span className="font-bold">{Math.floor(resources.wood)}</span>
          </div>
          <div className="flex items-center gap-2">
            <HardHat className="w-5 h-5 text-stone-400" />
            <span className="font-bold">{Math.floor(resources.stone)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Gem className="w-5 h-5 text-yellow-400" />
            <span className="font-bold">{Math.floor(resources.gold)}</span>
          </div>
          <div className="flex items-center gap-2 border-l border-slate-600 pl-4">
            <Users className="w-5 h-5 text-blue-400" />
            <span className="font-bold">{resources.population} / {resources.populationCap}</span>
          </div>
        </div>

        <div className="flex gap-4">
            {/* Time Control */}
            <div className="bg-slate-900/90 backdrop-blur-md p-3 rounded-xl border border-slate-700 text-slate-100 pointer-events-auto flex flex-col items-center min-w-[140px]">
                 <div className="text-sm text-slate-400 uppercase tracking-wider font-semibold mb-2">
                    Year {Math.floor(turn / 12) + 1} - Month {turn % 12 + 1}
                 </div>
                 
                 <button 
                    onClick={onTogglePause}
                    className={`w-full flex items-center justify-center gap-2 py-1.5 px-4 rounded-lg font-bold transition-all text-sm border ${
                        isPlaying 
                            ? 'bg-amber-600/20 border-amber-500 text-amber-500 hover:bg-amber-600/30' 
                            : 'bg-emerald-600/20 border-emerald-500 text-emerald-500 hover:bg-emerald-600/30'
                    }`}
                 >
                    {isPlaying ? (
                        <>
                            <Pause className="w-4 h-4 fill-current" />
                            <span>Pause</span>
                        </>
                    ) : (
                        <>
                            <Play className="w-4 h-4 fill-current" />
                            <span>Resume</span>
                        </>
                    )}
                 </button>
            </div>
        </div>
      </div>

      {/* Event Modal */}
      {lastEvent && (
        <div className="absolute top-24 left-1/2 transform -translate-x-1/2 w-96 pointer-events-auto animate-in fade-in slide-in-from-top-4 duration-500 z-[100]">
            <div className={`
                p-6 rounded-lg border-2 shadow-2xl backdrop-blur-xl relative
                ${lastEvent.severity === 'BAD' ? 'bg-red-950/95 border-red-500 text-red-100' : 
                  lastEvent.severity === 'GOOD' ? 'bg-emerald-950/95 border-emerald-500 text-emerald-100' : 
                  'bg-slate-800/95 border-slate-500 text-slate-100'}
            `}>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseEvent();
                  }}
                  className="absolute top-2 right-2 p-2 hover:bg-black/30 rounded-full transition-colors cursor-pointer z-50"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>

                <h3 className="text-xl font-bold mb-2 flex items-center justify-between pr-8">
                    {lastEvent.title}
                </h3>
                <div className="mb-4">
                    <span className="text-xs uppercase bg-black/30 px-2 py-1 rounded font-bold">{lastEvent.severity}</span>
                </div>
                
                <p className="text-sm mb-4 opacity-90 leading-relaxed">{lastEvent.description}</p>
                
                {lastEvent.effect && (
                    <div className="text-xs font-mono bg-black/30 p-3 rounded mb-4 border border-white/10">
                        {lastEvent.effect}
                    </div>
                )}
                
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseEvent();
                  }}
                  className="w-full py-2 bg-white/10 hover:bg-white/20 rounded font-bold text-sm uppercase transition-colors cursor-pointer border border-white/10"
                >
                  Dismiss
                </button>
            </div>
        </div>
      )}

      {/* Bottom Bar: Controls */}
      <div className="bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-slate-700 pointer-events-auto self-center flex gap-8 shadow-2xl">
        
        {/* Buildings */}
        <div className="flex flex-col gap-2">
            <span className="text-xs text-slate-400 font-bold uppercase">Construction</span>
            <div className="flex gap-2">
                {Object.values(BuildingType).map((bType) => {
                    const cost = BUILD_COSTS[bType];
                    const canAfford = resources.wood >= (cost.wood || 0) && resources.stone >= (cost.stone || 0) && resources.gold >= (cost.gold || 0);
                    
                    return (
                        <button
                            key={bType}
                            onClick={() => {
                                setUnitMode(null);
                                setBuildMode(selectedBuildMode === bType ? null : bType);
                            }}
                            className={`
                                relative group p-3 rounded-lg border-2 transition-all cursor-pointer
                                ${selectedBuildMode === bType ? 'border-yellow-400 bg-yellow-400/20' : 'border-slate-600 hover:border-slate-400 bg-slate-800'}
                                ${!canAfford && 'opacity-50 grayscale cursor-not-allowed'}
                            `}
                        >
                            <Hammer className="w-6 h-6 text-orange-400" />
                            <span className="text-[10px] block mt-1 uppercase text-slate-300">{bType.replace('_', ' ')}</span>
                            
                            {/* Tooltip */}
                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-32 bg-black/90 p-2 rounded text-xs hidden group-hover:block z-50 pointer-events-none border border-slate-700">
                                <div className="text-white font-bold mb-1">{bType}</div>
                                <div className="text-emerald-400">Wood: {cost.wood || 0}</div>
                                <div className="text-stone-400">Stone: {cost.stone || 0}</div>
                                <div className="text-yellow-400">Gold: {cost.gold || 0}</div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>

        {/* Units */}
        <div className="flex flex-col gap-2 pl-8 border-l border-slate-700">
            <span className="text-xs text-slate-400 font-bold uppercase">Recruitment</span>
            <div className="flex gap-2">
                {Object.values(UnitType).map((uType) => {
                     const cost = UNIT_COSTS[uType];
                     const canAfford = resources.gold >= (cost.gold || 0) && resources.wood >= (cost.wood || 0) && resources.population < resources.populationCap;

                    return (
                        <button
                            key={uType}
                            onClick={() => {
                                setBuildMode(null);
                                setUnitMode(selectedUnitMode === uType ? null : uType);
                            }}
                            className={`
                                relative group p-3 rounded-lg border-2 transition-all cursor-pointer
                                ${selectedUnitMode === uType ? 'border-blue-400 bg-blue-400/20' : 'border-slate-600 hover:border-slate-400 bg-slate-800'}
                                ${!canAfford && 'opacity-50 grayscale cursor-not-allowed'}
                            `}
                        >
                            <Sword className="w-6 h-6 text-blue-400" />
                            <span className="text-[10px] block mt-1 uppercase text-slate-300">{uType}</span>
                             
                             {/* Tooltip */}
                             <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-32 bg-black/90 p-2 rounded text-xs hidden group-hover:block z-50 pointer-events-none border border-slate-700">
                                <div className="text-white font-bold mb-1">{uType}</div>
                                <div className="text-yellow-400">Gold: {cost.gold || 0}</div>
                                <div className="text-blue-200">Pop: 1</div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>

      </div>
    </div>
  );
};