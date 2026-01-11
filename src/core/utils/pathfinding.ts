/**
 * @module Core/Pathfinding
 * @layer Core
 * @description Высокопроизводительный сервис поиска пути (A*).
 * Использует TypedArrays (Float32Array) для минимизации нагрузки на память и GC.
 * 
 * COORDINATE SYSTEM:
 * - World Coordinates: Float or Integer, centered at (0,0). 1 unit = 1 tile.
 * - Grid Coordinates: Integer indices [0..size-1].
 * - Conversion: Grid = Math.round(World) + halfSize.
 * 
 * API CONTRACT:
 * - findPath returns an array of coordinates EXCLUDING the start node.
 * - If start === end, returns empty array.
 * - If no path found, returns empty array.
 */

import { TileData, TileType } from '../../entities/Map';
import { Coordinates } from '../../shared/types';

// REFERENCE: High-performance A* Pathfinding (v2.6)
// Improvements (v2.6): 
// - Reduced initial memory footprint (Heap capacity 1024 vs TotalTiles)
// - LRU Cache Eviction Strategy
// - Max Pool Size Limit
// - Explicit API Documentation

const COSTS = {
  ROAD: 0.5,
  GRASS: 1.0,
  FOREST: 1.5,
  OBSTACLE: Infinity, 
  MIN_STEP: 0.5 
} as const;

export type NavigationLayer = TileType | 'ROAD' | 'BUILDING';

const WEIGHT_MAP: Record<string, number> = {
  'ROAD': COSTS.ROAD,
  'GRASS': COSTS.GRASS,
  'FOREST': COSTS.FOREST,
  'WATER': COSTS.OBSTACLE,
  'MOUNTAIN': COSTS.OBSTACLE,
  'BUILDING': COSTS.OBSTACLE
};

/**
 * Структура буферов, необходимых для одного вычисления A*.
 */
interface ComputeBuffers {
  gScore: Float32Array;
  parentIndex: Int32Array;
  visited: Uint8Array;
  heap: FlatMinHeap;
  neighbors: Int32Array; // Fixed size 4 for Von Neumann neighborhood
}

/**
 * Оптимизированная куча (MinHeap) на базе TypedArrays.
 * Поддерживает авто-расширение и tie-breaking.
 */
class FlatMinHeap {
  private indices: Int32Array;
  private f: Float32Array;
  private g: Float32Array;
  public length: number = 0;

  constructor(initialCapacity: number) {
    this.indices = new Int32Array(initialCapacity);
    this.f = new Float32Array(initialCapacity);
    this.g = new Float32Array(initialCapacity);
  }

  push(index: number, fVal: number, gVal: number) {
    if (this.length >= this.indices.length) {
      this.resize();
    }
    this.indices[this.length] = index;
    this.f[this.length] = fVal;
    this.g[this.length] = gVal;
    this.bubbleUp(this.length);
    this.length++;
  }

  pop(): { index: number, g: number } | undefined {
    if (this.length === 0) return undefined;

    const topIndex = this.indices[0];
    const topG = this.g[0];

    this.length--;
    if (this.length > 0) {
      this.indices[0] = this.indices[this.length];
      this.f[0] = this.f[this.length];
      this.g[0] = this.g[this.length];
      this.sinkDown(0);
    }

    return { index: topIndex, g: topG };
  }

  clear() {
    this.length = 0;
  }

  isEmpty() {
    return this.length === 0;
  }

  private resize() {
    // Grow by 2x, min 16
    const newCap = Math.max(this.indices.length * 2, 16);
    const newInd = new Int32Array(newCap);
    const newF = new Float32Array(newCap);
    const newG = new Float32Array(newCap);
    
    newInd.set(this.indices);
    newF.set(this.f);
    newG.set(this.g);
    
    this.indices = newInd;
    this.f = newF;
    this.g = newG;
  }

  private bubbleUp(idx: number) {
    while (idx > 0) {
      const parentIdx = (idx - 1) >>> 1;
      
      const cf = this.f[idx];
      const pf = this.f[parentIdx];
      
      // MinHeap property: Parent must be smaller. If Child > Parent, order is correct.
      if (cf > pf) break;
      
      // Tie-breaking: If F is equal, prefer HIGHER G (closer to target in reliable heuristics)
      // So if Child G <= Parent G, it's not "better", so we stop.
      if (cf === pf && this.g[idx] <= this.g[parentIdx]) break;
      
      this.swap(idx, parentIdx);
      idx = parentIdx;
    }
  }

  private sinkDown(idx: number) {
    const halfLen = this.length >>> 1;
    while (idx < halfLen) {
      let left = (idx << 1) + 1;
      let right = left + 1;
      let best = idx;

      const bf = this.f[best];
      const lf = this.f[left];

      // Check Left
      let swapLeft = false;
      if (lf < bf) {
          swapLeft = true;
      } else if (lf === bf && this.g[left] > this.g[best]) {
          swapLeft = true;
      }

      if (swapLeft) best = left;

      // Check Right
      if (right < this.length) {
          const rf = this.f[right];
          const bestF = this.f[best];
          
          let swapRight = false;
          if (rf < bestF) {
              swapRight = true;
          } else if (rf === bestF && this.g[right] > this.g[best]) {
              swapRight = true;
          }
          
          if (swapRight) best = right;
      }

      if (best === idx) break;

      this.swap(idx, best);
      idx = best;
    }
  }

  private swap(i: number, j: number) {
    const tempI = this.indices[i];
    const tempF = this.f[i];
    const tempG = this.g[i];

    this.indices[i] = this.indices[j];
    this.f[i] = this.f[j];
    this.g[i] = this.g[j];

    this.indices[j] = tempI;
    this.f[j] = tempF;
    this.g[j] = tempG;
  }
}

/**
 * Синглтон-сервис для навигации.
 * Хранит карту весов и пул буферов для параллельных вычислений.
 */
export class PathfindingService {
  private grid: Float32Array;
  private size: number = 0;
  private halfSize: number = 0;
  private gridVersion: number = 0;
  
  // Cache uses LRU strategy (via Map insertion order)
  private pathCache: Map<string, { path: Coordinates[]; version: number }> = new Map();
  private maxCacheSize: number = 2000;
  
  // Buffer Pool for Thread Safety (Reentrancy)
  private bufferPool: ComputeBuffers[] = [];
  private maxPoolSize: number = 4;
  
  private defaultMaxIterations: number = 10000;

  constructor() {
    this.grid = new Float32Array(0);
  }

  /**
   * Инициализирует навигационную сетку.
   * Очищает пул буферов, так как размер карты изменился.
   */
  public syncWithStore(tiles: TileData[], size: number): void {
    this.size = size;
    this.halfSize = Math.floor(size / 2);
    
    const totalTiles = size * size;
    
    // 1. Setup Grid
    if (this.grid.length !== totalTiles) {
        this.grid = new Float32Array(totalTiles);
    }
    this.grid.fill(COSTS.OBSTACLE);

    tiles.forEach(tile => {
      const idx = this.toIndex(tile.x, tile.z);
      if (idx !== -1) {
          let weight = this.getWeightByType(tile.type);
          if (tile.occupiedBy) weight = COSTS.OBSTACLE;
          this.grid[idx] = weight;
      }
    });

    // 2. Reset Buffer Pool (Invalidate old buffers)
    this.bufferPool = [];
    
    // 3. Reset Cache
    this.gridVersion++;
    this.pathCache.clear();
  }

  public updateNode(x: number, z: number, type: NavigationLayer, occupied: boolean = false): void {
    const idx = this.toIndex(x, z);
    if (idx === -1) return;
    
    let weight = this.getWeightByType(type);
    if (occupied) {
        weight = COSTS.OBSTACLE;
    }
    
    if (this.grid[idx] !== weight) {
       this.grid[idx] = weight;
       this.gridVersion++;
    }
  }

  public isWalkable(x: number, z: number): boolean {
    const idx = this.toIndex(x, z);
    if (idx === -1) return false;
    return Number.isFinite(this.grid[idx]);
  }

  /**
   * Finds a path from start to end.
   * @param start World coordinates of start position
   * @param end World coordinates of target position
   * @param options Configuration options
   * @returns Array of coordinates representing the path, EXCLUDING the start node.
   */
  public async findPath(
      start: Coordinates, 
      end: Coordinates, 
      options: { maxIterations?: number } = {}
  ): Promise<Coordinates[]> {
    const sIdx = this.toIndex(start.x, start.z);
    const eIdx = this.toIndex(end.x, end.z);

    // Fail Fast
    if (sIdx === -1 || eIdx === -1) return [];
    if (sIdx === eIdx) return [];
    if (!Number.isFinite(this.grid[sIdx]) || !Number.isFinite(this.grid[eIdx])) return [];

    // Check Cache (LRU)
    const cacheKey = `${sIdx}-${eIdx}`;
    const cached = this.pathCache.get(cacheKey);
    if (cached && cached.version === this.gridVersion) {
        // Refresh: remove and re-insert to mark as recently used
        this.pathCache.delete(cacheKey);
        this.pathCache.set(cacheKey, cached);
        return cached.path;
    }

    // Acquire Buffers
    const buffers = this.acquireBuffers();
    
    try {
        const maxIter = options.maxIterations ?? this.defaultMaxIterations;
        const result = this.calculateAStar(sIdx, eIdx, maxIter, buffers);
        
        if (result.length > 0) {
          // Cache Maintenance (LRU Eviction)
          if (this.pathCache.size >= this.maxCacheSize) {
              // Map.keys() returns iterator in insertion order. First item is oldest.
              const oldestKey = this.pathCache.keys().next().value;
              if (oldestKey) this.pathCache.delete(oldestKey);
          }
          this.pathCache.set(cacheKey, { path: result, version: this.gridVersion });
        }
        
        return result;
    } finally {
        this.releaseBuffers(buffers);
    }
  }

  private calculateAStar(
      startIdx: number, 
      endIdx: number, 
      maxIterations: number, 
      buffers: ComputeBuffers
  ): Coordinates[] {
    const { gScore, parentIndex, visited, heap, neighbors } = buffers;

    // Reset logic (fast fill)
    gScore.fill(Infinity);
    parentIndex.fill(-1);
    visited.fill(0);
    heap.clear();
    
    gScore[startIdx] = 0;
    heap.push(startIdx, this.heuristic(startIdx, endIdx), 0);

    let iterations = 0;

    while (!heap.isEmpty()) {
      iterations++;
      if (iterations > maxIterations) return [];

      const current = heap.pop()!;
      const currentIdx = current.index;

      // Lazy Deletion
      if (current.g > gScore[currentIdx]) continue;
      
      if (visited[currentIdx]) continue;
      visited[currentIdx] = 1;

      if (currentIdx === endIdx) {
        return this.reconstructPath(endIdx, parentIndex);
      }

      const count = this.fillNeighborsBuffer(currentIdx, neighbors);
      
      for (let i = 0; i < count; i++) {
        const neighborIdx = neighbors[i];
        
        if (visited[neighborIdx]) continue;
        
        const weight = this.grid[neighborIdx];
        if (!Number.isFinite(weight)) continue;

        const tentativeG = current.g + weight;

        if (tentativeG < gScore[neighborIdx]) {
          parentIndex[neighborIdx] = currentIdx;
          gScore[neighborIdx] = tentativeG;
          const f = tentativeG + this.heuristic(neighborIdx, endIdx);
          heap.push(neighborIdx, f, tentativeG);
        }
      }
    }

    return [];
  }

  // --- Pool Management ---

  private createBuffers(size: number): ComputeBuffers {
      // Small initial capacity for heap to save memory. 
      // It will resize automatically if path is complex.
      const initialHeapCap = 1024; 
      
      return {
          gScore: new Float32Array(size),
          parentIndex: new Int32Array(size),
          visited: new Uint8Array(size),
          heap: new FlatMinHeap(initialHeapCap),
          neighbors: new Int32Array(4)
      };
  }

  private acquireBuffers(): ComputeBuffers {
      if (this.bufferPool.length > 0) {
          return this.bufferPool.pop()!;
      }
      // Create new if pool empty or exhausted
      const totalTiles = this.size * this.size;
      return this.createBuffers(totalTiles);
  }

  private releaseBuffers(buffers: ComputeBuffers) {
      if (this.bufferPool.length < this.maxPoolSize) {
          this.bufferPool.push(buffers);
      }
      // If pool is full, let GC collect these buffers
  }

  // --- Helpers ---

  private heuristic(aIdx: number, bIdx: number): number {
    const ax = aIdx % this.size;
    const az = Math.floor(aIdx / this.size);
    const bx = bIdx % this.size;
    const bz = Math.floor(bIdx / this.size);
    return (Math.abs(ax - bx) + Math.abs(az - bz)) * COSTS.MIN_STEP;
  }

  private reconstructPath(endIdx: number, parentIndex: Int32Array): Coordinates[] {
    const path: Coordinates[] = [];
    let curr = endIdx;
    
    // Standard reconstruction: Stop when we reach start node (parent is -1)
    // This results in a path that excludes the start node.
    while (parentIndex[curr] !== -1) {
      const gx = curr % this.size;
      const gz = Math.floor(curr / this.size);
      
      path.push({ 
        x: this.toWorldX(gx), 
        z: this.toWorldZ(gz) 
      });
      
      curr = parentIndex[curr];
    }
    
    return path.reverse();
  }

  private fillNeighborsBuffer(idx: number, buffer: Int32Array): number {
    const x = idx % this.size;
    const z = Math.floor(idx / this.size);
    let count = 0;

    if (x > 0) buffer[count++] = idx - 1;
    if (x < this.size - 1) buffer[count++] = idx + 1;
    if (z > 0) buffer[count++] = idx - this.size;
    if (z < this.size - 1) buffer[count++] = idx + this.size;

    return count;
  }

  /**
   * Converts world X to grid index.
   * Strategy: Round to nearest integer.
   * -0.4 -> 0
   * 0.4 -> 0
   * 0.6 -> 1
   */
  private toGridX(worldX: number): number {
    return Math.round(worldX) + this.halfSize;
  }

  private toGridZ(worldZ: number): number {
    return Math.round(worldZ) + this.halfSize;
  }

  private toWorldX(gridX: number): number {
    return gridX - this.halfSize;
  }

  private toWorldZ(gridZ: number): number {
    return gridZ - this.halfSize;
  }

  private toIndex(worldX: number, worldZ: number): number {
    const gx = this.toGridX(worldX);
    const gz = this.toGridZ(worldZ);
    
    if (gx < 0 || gx >= this.size || gz < 0 || gz >= this.size) return -1;
    return gz * this.size + gx;
  }

  private getWeightByType(type: NavigationLayer): number {
    // Ensure strict string conversion for safety if type is ever passed incorrectly
    const t = String(type).toUpperCase();
    return WEIGHT_MAP[t] ?? COSTS.GRASS;
  }
}

export const pathfindingService = new PathfindingService();
