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
 * - findPath returns a PathResult object containing the path and status.
 * - By default, path **excludes the start node** and includes the end node.
 * - This behavior can be changed via options.includeStartNode.
 */

import { TileData, TileType } from '../../entities/Map';
import { Coordinates } from '../../shared/types';

// REFERENCE: High-performance A* Pathfinding (v3.5.0)
// Improvements (v3.5.0): 
// - Fixed tentativeG calculation to use gScore source of truth
// - Added 'failToClosest' option (RTS-style movement to unreachable targets)
// - Relaxed target walkability checks when failToClosest is enabled

const COSTS = {
  ROAD: 0.5,
  GRASS: 1.0,
  FOREST: 1.5,
  OBSTACLE: Infinity, 
  MIN_STEP: 0.5 
} as const;

// Epsilon for float comparisons to ensure stable tie-breaking
const EPSILON = 1e-6;

export type NavigationLayer = TileType | 'ROAD' | 'BUILDING';

// Strict mapping using the NavigationLayer type
const WEIGHT_MAP: Record<NavigationLayer | string, number> = {
  [TileType.GRASS]: COSTS.GRASS,
  [TileType.FOREST]: COSTS.FOREST,
  [TileType.WATER]: COSTS.OBSTACLE,
  [TileType.MOUNTAIN]: COSTS.OBSTACLE,
  'ROAD': COSTS.ROAD,
  'BUILDING': COSTS.OBSTACLE
};

export type PathStatus = 'success' | 'no_path' | 'timeout' | 'invalid_args' | 'aborted' | 'partial_path';

export interface PathResult {
  path: Coordinates[];
  status: PathStatus;
  metrics?: {
    iterations: number;
    duration: number;
    cached?: boolean;
    isPartial?: boolean;
  };
}

export interface PathOptions {
  maxIterations?: number;
  signal?: AbortSignal;
  heuristicWeight?: number; // > 1.0 for faster, greedy search
  includeStartNode?: boolean; // If true, the path includes the start coordinates
  failToClosest?: boolean; // If target is unreachable, return path to the closest reachable node
}

const MAX_NEIGHBORS = 4;

/**
 * Структура буферов, необходимых для одного вычисления A*.
 */
interface ComputeBuffers {
  gScore: Float32Array; // Dirty buffer
  parentIndex: Int32Array; // Dirty buffer
  
  // Generation counters.
  // Instead of clearing arrays (O(N)), we increment a searchId.
  // If array[i] != searchId, the node is considered uninitialized/not visited.
  nodeState: Uint32Array; // Tracks if node was touched in this search (for gScore/parent init)
  closedSet: Uint32Array; // Tracks if node is in Closed Set (fully expanded)
  
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
    
    // Insert at the end
    const i = this.length;
    this.indices[i] = index;
    this.f[i] = fVal;
    this.g[i] = gVal;
    
    this.length++;
    this.bubbleUp(i);
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
      
      // MinHeap property: Parent must be smaller (smaller F is better).
      if (cf > pf + EPSILON) break;
      
      // Tie-breaking:
      // If F is roughly equal, we prioritize nodes with HIGHER G (closer to target).
      if (Math.abs(cf - pf) < EPSILON) {
         if (this.g[idx] <= this.g[parentIdx]) break;
      }
      
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
      if (lf < bf - EPSILON) { 
          swapLeft = true;
      } else if (Math.abs(lf - bf) < EPSILON && this.g[left] > this.g[best]) {
          swapLeft = true;
      }

      if (swapLeft) best = left;

      // Check Right
      if (right < this.length) {
          const rf = this.f[right];
          const bestF = this.f[best];
          
          let swapRight = false;
          if (rf < bestF - EPSILON) {
              swapRight = true;
          } else if (Math.abs(rf - bestF) < EPSILON && this.g[right] > this.g[best]) {
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
  private totalTiles: number = 0;
  private halfSize: number = 0;
  private gridVersion: number = 0;
  
  // Fixed min step cost to ensure admissibility
  private readonly minStepCost: number = COSTS.MIN_STEP;
  
  // Tracks global search generation to allow O(1) buffer reset
  private globalSearchId: number = 0;
  
  // Cache uses LRU strategy
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
   */
  public syncWithStore(tiles: TileData[], size: number): void {
    this.size = size;
    this.totalTiles = size * size;
    this.halfSize = (size / 2) | 0; // Bitwise floor
    
    // Safety check for large maps
    if (this.totalTiles > 2048 * 2048) {
       console.warn(`[Pathfinding] Map size ${size}x${size} is very large. Memory usage will be significant.`);
    }

    // 1. Setup Grid
    if (this.grid.length !== this.totalTiles) {
        this.grid = new Float32Array(this.totalTiles);
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
    this.globalSearchId = 0; 
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
   */
  public async findPath(
      start: Coordinates, 
      end: Coordinates, 
      options: PathOptions = {}
  ): Promise<PathResult> {
    const startTime = performance.now();
    
    if (options.signal?.aborted) {
        return { path: [], status: 'aborted' };
    }

    const sIdx = this.toIndex(start.x, start.z);
    const eIdx = this.toIndex(end.x, end.z);
    const maxIter = options.maxIterations ?? this.defaultMaxIterations;
    const hWeight = options.heuristicWeight ?? 1.0;
    const includeStart = options.includeStartNode ?? false;
    const failToClosest = options.failToClosest ?? false;

    // Fail Fast
    if (sIdx === -1 || eIdx === -1) {
        return { path: [], status: 'invalid_args' };
    }
    
    // Check if Start == End
    if (sIdx === eIdx) {
        const path = includeStart ? [{ ...end }] : [];
        return { path, status: 'success', metrics: { iterations: 0, duration: 0 } };
    }
    
    // Walkability Checks
    // If failToClosest is TRUE, we allow invalid eIdx because we might want to get CLOSE to it.
    if (!Number.isFinite(this.grid[sIdx])) return { path: [], status: 'no_path' };
    if (!failToClosest && !Number.isFinite(this.grid[eIdx])) return { path: [], status: 'no_path' };

    // Check Cache (LRU)
    // Cache Key must include failToClosest
    const cacheKey = `${sIdx}-${eIdx}-${maxIter}-${hWeight}-${includeStart}-${failToClosest}`;
    const cached = this.pathCache.get(cacheKey);
    if (cached && cached.version === this.gridVersion) {
        const duration = performance.now() - startTime;
        // Refresh: remove and re-insert to mark as recently used
        this.pathCache.delete(cacheKey);
        this.pathCache.set(cacheKey, cached);
        return { 
            path: cached.path, 
            status: 'success',
            metrics: { iterations: 0, duration, cached: true } 
        };
    }

    // Acquire Buffers
    const buffers = this.acquireBuffers();
    
    try {
        const result = this.calculateAStar(
            sIdx, eIdx, maxIter, hWeight, includeStart, failToClosest, 
            buffers, options.signal
        );
        const duration = performance.now() - startTime;
        
        if (result.status === 'success' || result.status === 'partial_path') {
          // Cache Maintenance (LRU Eviction)
          if (this.pathCache.size >= this.maxCacheSize) {
              const oldestKey = this.pathCache.keys().next().value;
              if (oldestKey) this.pathCache.delete(oldestKey);
          }
          this.pathCache.set(cacheKey, { path: result.path, version: this.gridVersion });
        }
        
        return {
            ...result,
            metrics: {
                iterations: result.iterations,
                duration,
                cached: false,
                isPartial: result.status === 'partial_path'
            }
        };
    } finally {
        this.releaseBuffers(buffers);
    }
  }

  private calculateAStar(
      startIdx: number, 
      endIdx: number, 
      maxIterations: number,
      heuristicWeight: number,
      includeStart: boolean,
      failToClosest: boolean,
      buffers: ComputeBuffers,
      signal?: AbortSignal
  ): { path: Coordinates[], status: PathStatus, iterations: number } {
    const { gScore, parentIndex, closedSet, nodeState, heap, neighbors } = buffers;

    // --- GENERATION BASED RESET (Lazy Init) ---
    this.globalSearchId++;
    if (this.globalSearchId >= 0xFFFFFFFF) {
        this.globalSearchId = 1;
        nodeState.fill(0);
        closedSet.fill(0);
    }
    const currentId = this.globalSearchId;

    // Initialize Start Node
    heap.clear();
    gScore[startIdx] = 0;
    parentIndex[startIdx] = -1;
    nodeState[startIdx] = currentId;
    
    heap.push(startIdx, this.heuristic(startIdx, endIdx) * heuristicWeight, 0);

    let iterations = 0;
    
    // Tracking for failToClosest
    let closestNodeIdx = startIdx;
    let minH = Infinity;

    while (!heap.isEmpty()) {
      iterations++;
      
      if (signal?.aborted) return { path: [], status: 'aborted', iterations };
      if (iterations > maxIterations) break; // Will handle as fail/closest below

      const current = heap.pop()!;
      const currentIdx = current.index;

      // Lazy check: if we found a better G for this node already, skip
      const currentG = (nodeState[currentIdx] === currentId) ? gScore[currentIdx] : Infinity;
      if (current.g > currentG) continue;
      
      // Update closest node (Min H to target)
      if (failToClosest) {
          // Note: Heuristic uses simple Manhattan
          const h = this.heuristic(currentIdx, endIdx);
          if (h < minH) {
              minH = h;
              closestNodeIdx = currentIdx;
          }
      }

      // Closed Set check
      if (closedSet[currentIdx] === currentId) continue;
      closedSet[currentIdx] = currentId;

      if (currentIdx === endIdx) {
        const path = this.reconstructPath(endIdx, parentIndex, includeStart);
        return { path, status: 'success', iterations };
      }

      const count = this.fillNeighborsBuffer(currentIdx, neighbors);
      
      for (let i = 0; i < count; i++) {
        const neighborIdx = neighbors[i];
        
        if (closedSet[neighborIdx] === currentId) continue;
        
        const weight = this.grid[neighborIdx];
        if (!Number.isFinite(weight)) continue;

        if (nodeState[neighborIdx] !== currentId) {
            gScore[neighborIdx] = Infinity;
            parentIndex[neighborIdx] = -1;
            nodeState[neighborIdx] = currentId;
        }

        // CRITICAL FIX: Use currentG (from array source of truth) + weight
        const tentativeG = currentG + weight;

        // Strict Check
        if (tentativeG < gScore[neighborIdx]) {
          parentIndex[neighborIdx] = currentIdx;
          gScore[neighborIdx] = tentativeG;
          const f = tentativeG + (this.heuristic(neighborIdx, endIdx) * heuristicWeight);
          heap.push(neighborIdx, f, tentativeG);
        }
      }
    }
    
    // Path not found or timeout
    if (failToClosest) {
         // Return path to the node that got closest to the target
         const path = this.reconstructPath(closestNodeIdx, parentIndex, includeStart);
         return { path, status: 'partial_path', iterations };
    }

    return { path: [], status: iterations > maxIterations ? 'timeout' : 'no_path', iterations };
  }

  // --- Pool Management ---

  private createBuffers(size: number): ComputeBuffers {
      const initialHeapCap = Math.max(16, (size / 4) | 0);
      
      return {
          gScore: new Float32Array(size),
          parentIndex: new Int32Array(size),
          nodeState: new Uint32Array(size),
          closedSet: new Uint32Array(size),
          heap: new FlatMinHeap(initialHeapCap),
          neighbors: new Int32Array(MAX_NEIGHBORS)
      };
  }

  private acquireBuffers(): ComputeBuffers {
      if (this.bufferPool.length > 0) {
          return this.bufferPool.pop()!;
      }
      
      if (this.globalSearchId > 100) {
          console.warn(`[Pathfinding] Buffer pool exhausted. Allocating new buffers. Active searches > ${this.maxPoolSize}`);
      }

      const totalTiles = this.size * this.size;
      return this.createBuffers(totalTiles);
  }

  private releaseBuffers(buffers: ComputeBuffers) {
      if (this.bufferPool.length < this.maxPoolSize) {
          this.bufferPool.push(buffers);
      }
  }

  // --- Helpers ---

  private heuristic(aIdx: number, bIdx: number): number {
    const ax = aIdx % this.size;
    const az = (aIdx / this.size) | 0;
    
    const bx = bIdx % this.size;
    const bz = (bIdx / this.size) | 0;
    
    return (Math.abs(ax - bx) + Math.abs(az - bz)) * this.minStepCost;
  }

  private reconstructPath(endIdx: number, parentIndex: Int32Array, includeStart: boolean): Coordinates[] {
    const path: Coordinates[] = [];
    let curr = endIdx;
    
    // Guard: Prevent infinite loops if parentIndex corrupted (should not happen)
    let safety = 0;
    const maxLen = this.totalTiles;

    while (curr !== -1 && safety < maxLen) {
      const gx = curr % this.size;
      const gz = (curr / this.size) | 0;
      
      path.push({ 
        x: this.toWorldX(gx), 
        z: this.toWorldZ(gz) 
      });
      
      curr = parentIndex[curr];
      safety++;
    }
    
    path.reverse(); 
    if (!includeStart && path.length > 0) {
        path.shift(); // Remove start node
    }
    return path;
  }

  private fillNeighborsBuffer(idx: number, buffer: Int32Array): number {
    const x = idx % this.size;
    let count = 0;

    // Left
    if (x > 0) buffer[count++] = idx - 1;
    // Right
    if (x < this.size - 1) buffer[count++] = idx + 1;
    // Top
    if (idx >= this.size) buffer[count++] = idx - this.size;
    // Bottom
    if (idx < this.totalTiles - this.size) buffer[count++] = idx + this.size;

    return count;
  }

  private toGridX(worldX: number): number {
    return (Math.round(worldX) + this.halfSize) | 0;
  }

  private toGridZ(worldZ: number): number {
    return (Math.round(worldZ) + this.halfSize) | 0;
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
    return WEIGHT_MAP[type] ?? COSTS.GRASS;
  }
}

export const pathfindingService = new PathfindingService();
