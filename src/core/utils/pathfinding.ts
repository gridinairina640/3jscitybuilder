/**
 * @module Core/Pathfinding
 * @layer Core
 * @description Высокопроизводительный сервис поиска пути (A*).
 * Использует TypedArrays (Float32Array) для минимизации нагрузки на память и GC.
 * 
 * COORDINATE SYSTEM:
 * - World Coordinates: Float or Integer, centered at (0,0). 1 unit = 1 tile.
 * - Grid Coordinates: Integer indices [0..size-1].
 * - Conversion: Grid = Math.floor(World + 0.5) + halfSize.
 * 
 * API CONTRACT:
 * - findPath returns a PathResult object containing the path and status.
 * - By default, path **excludes the start node** and includes the end node.
 */

import { TileData, TileType } from '../../entities/Map';
import { Coordinates } from '../../shared/types';

// REFERENCE: High-performance A* Pathfinding (v3.10.0)
// Improvements (v3.10.0):
// - Added Static Path Caching (Nebuchadnezzar Style).
// - Added methods getStaticPath / saveStaticPath for persistent routes between entities.
// - Static paths use lazy invalidation via gridVersion check.

const COSTS = {
  ROAD: 0.5,
  GRASS: 1.0,
  FOREST: 1.5,
  OBSTACLE: Infinity, 
  MIN_STEP: 0.5 
} as const;

// Epsilon for float comparisons. 
const EPSILON = 1e-5;

// Warning threshold for gScore in Float32 to avoid precision loss issues
const FLOAT32_SAFE_LIMIT = 1e7;

export type NavigationLayer = TileType | 'ROAD' | 'BUILDING';

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
    activeSearches?: number;
    cacheHits?: number;
    cacheMisses?: number;
  };
}

export interface PathOptions {
  maxIterations?: number;
  signal?: AbortSignal;
  heuristicWeight?: number; 
  includeStartNode?: boolean;
  failToClosest?: boolean;
}

const MAX_NEIGHBORS = 4;

interface ComputeBuffers {
  gScore: Float32Array; 
  parentIndex: Int32Array; 
  nodeState: Uint32Array; 
  closedSet: Uint32Array; 
  heap: FlatMinHeap;
  neighbors: Int32Array; 
}

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
    if (this.length >= this.indices.length) this.resize();
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

  clear() { this.length = 0; }
  isEmpty() { return this.length === 0; }

  private resize() {
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
      
      if (cf > pf + EPSILON) break;
      
      // Tie-breaking: Prefer Higher G (closer to target in most heuristics)
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

      let swapLeft = false;
      if (lf < bf - EPSILON) swapLeft = true;
      else if (Math.abs(lf - bf) < EPSILON && this.g[left] > this.g[best]) swapLeft = true;

      if (swapLeft) best = left;

      if (right < this.length) {
          const rf = this.f[right];
          const bestF = this.f[best];
          let swapRight = false;
          if (rf < bestF - EPSILON) swapRight = true;
          else if (Math.abs(rf - bestF) < EPSILON && this.g[right] > this.g[best]) swapRight = true;
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
    this.indices[j] = tempI;
    this.f[j] = tempF;
    this.g[j] = tempG;
  }
}

export class PathfindingService {
  private grid: Float32Array;
  private size: number = 0;
  private totalTiles: number = 0;
  private halfSize: number = 0;
  private gridVersion: number = 0;
  private readonly minStepCost: number = COSTS.MIN_STEP;
  private globalSearchId: number = 0;
  
  private pathCache: Map<string, { path: Coordinates[]; version: number }> = new Map();
  private maxCacheSize: number = 2000;
  
  private bufferPool: ComputeBuffers[] = [];
  private maxPoolSize: number = 4;
  private activeSearches: number = 0;
  
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  
  private defaultMaxIterations: number = 10000;

  constructor() {
    this.grid = new Float32Array(0);
  }

  public syncWithStore(tiles: TileData[], size: number): void {
    this.size = size;
    this.totalTiles = size * size;
    this.halfSize = (size / 2) | 0;
    
    if (this.totalTiles > 2048 * 2048) {
       console.warn(`[Pathfinding] Map size ${size}x${size} is very large.`);
    }

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

    this.bufferPool = [];
    this.gridVersion++;
    this.pathCache.clear();
    this.globalSearchId = 0; 
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  public updateNode(x: number, z: number, type: NavigationLayer, occupied: boolean = false): void {
    const idx = this.toIndex(x, z);
    if (idx === -1) return;
    let weight = this.getWeightByType(type);
    if (occupied) weight = COSTS.OBSTACLE;
    
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
   * Получает статический маршрут между двумя зданиями/сущностями.
   * Проверяет gridVersion для ленивой инвалидации.
   */
  public getStaticPath(fromId: string, toId: string): Coordinates[] | null {
      const key = `static:${fromId}:${toId}`;
      const cached = this.pathCache.get(key);

      if (cached && cached.version === this.gridVersion) {
          this.cacheHits++;
          return [...cached.path];
      }
      
      if (cached) {
          this.cacheMisses++; // Version mismatch
      }

      return null;
  }

  /**
   * Публичный метод для проверки кэша (используется планировщиком).
   */
  public checkCache(start: Coordinates, end: Coordinates, options: PathOptions = {}): PathResult | null {
      const sIdx = this.toIndex(start.x, start.z);
      const eIdx = this.toIndex(end.x, end.z);
      
      if (sIdx === -1 || eIdx === -1) return null;

      const hWeight = options.heuristicWeight ?? 1.0;
      const includeStart = options.includeStartNode ?? false;
      const failToClosest = options.failToClosest ?? false;
      
      const safeHWeight = Math.round(hWeight * 100) / 100;
      const cacheKey = `${sIdx}-${eIdx}-${safeHWeight}-${includeStart}-${failToClosest}`;

      const cached = this.pathCache.get(cacheKey);
      if (cached && cached.version === this.gridVersion) {
          this.cacheHits++;
          return { 
            path: [...cached.path], 
            status: 'success',
            metrics: { iterations: 0, duration: 0, cached: true, cacheHits: this.cacheHits, cacheMisses: this.cacheMisses } 
          };
      }
      return null;
  }

  /**
   * Сохраняет статический маршрут между сущностями.
   */
  public saveStaticPath(fromId: string, toId: string, path: Coordinates[]): void {
      const key = `static:${fromId}:${toId}`;
      
      if (this.pathCache.size >= this.maxCacheSize) {
          const firstKey = this.pathCache.keys().next().value;
          if (firstKey) this.pathCache.delete(firstKey);
      }

      this.pathCache.set(key, {
          path: path,
          version: this.gridVersion
      });
  }

  public async findPath(
      start: Coordinates, 
      end: Coordinates, 
      options: PathOptions = {}
  ): Promise<PathResult> {
    const startTime = performance.now();
    
    // Check Cache immediately (Redundant if called via Scheduler, but safe for direct calls)
    const cachedResult = this.checkCache(start, end, options);
    if (cachedResult) return cachedResult;

    if (options.signal?.aborted) return { path: [], status: 'aborted' };

    const sIdx = this.toIndex(start.x, start.z);
    const eIdx = this.toIndex(end.x, end.z);
    
    // Validation
    if (!Number.isFinite(start.x) || !Number.isFinite(start.z) || 
        !Number.isFinite(end.x) || !Number.isFinite(end.z)) {
        return { path: [], status: 'invalid_args' };
    }
    if (sIdx === -1 || eIdx === -1) return { path: [], status: 'invalid_args' };
    
    // Short-circuits
    const includeStart = options.includeStartNode ?? false;
    if (sIdx === eIdx) {
        const path = includeStart ? [{ ...end }] : [];
        return { path, status: 'success', metrics: { iterations: 0, duration: 0 } };
    }
    
    const failToClosest = options.failToClosest ?? false;
    if (!Number.isFinite(this.grid[sIdx])) return { path: [], status: 'no_path' };
    if (!failToClosest && !Number.isFinite(this.grid[eIdx])) return { path: [], status: 'no_path' };

    // Set up search
    this.cacheMisses++;
    const buffers = this.acquireBuffers();
    const safetyLimit = Math.max(this.totalTiles * 2, 50000);
    const maxIter = Math.min(options.maxIterations ?? this.defaultMaxIterations, safetyLimit);
    const hWeight = options.heuristicWeight ?? 1.0;
    
    // Cache Key reconstruction for saving later
    const safeHWeight = Math.round(hWeight * 100) / 100;
    const cacheKey = `${sIdx}-${eIdx}-${safeHWeight}-${includeStart}-${failToClosest}`;

    try {
        const result = this.calculateAStar(
            sIdx, eIdx, maxIter, hWeight, includeStart, failToClosest, 
            buffers, options.signal
        );
        const duration = performance.now() - startTime;
        
        if (result.status === 'success') {
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
                isPartial: result.status === 'partial_path',
                activeSearches: this.activeSearches,
                cacheHits: this.cacheHits,
                cacheMisses: this.cacheMisses
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

    this.globalSearchId++;
    if (this.globalSearchId >= 0xFFFFFFF0) {
        this.globalSearchId = 1;
        nodeState.fill(0);
        closedSet.fill(0);
        gScore.fill(Infinity);
        parentIndex.fill(-1);
    }
    const currentId = this.globalSearchId;

    heap.clear();
    gScore[startIdx] = 0;
    parentIndex[startIdx] = -1;
    nodeState[startIdx] = currentId;
    
    heap.push(startIdx, this.heuristic(startIdx, endIdx) * heuristicWeight, 0);

    let iterations = 0;
    let closestNodeIdx = startIdx;
    let minH = Infinity;

    while (!heap.isEmpty()) {
      iterations++;
      if (signal?.aborted) return { path: [], status: 'aborted', iterations };
      if (iterations > maxIterations) break; 

      const current = heap.pop()!;
      const currentIdx = current.index;
      const currentG = (nodeState[currentIdx] === currentId) ? gScore[currentIdx] : Infinity;
      
      if (current.g > currentG) continue;
      
      if (failToClosest) {
          const h = this.heuristic(currentIdx, endIdx);
          if (h < minH) {
              minH = h;
              closestNodeIdx = currentIdx;
          }
      }

      if (closedSet[currentIdx] === currentId) continue;
      closedSet[currentIdx] = currentId;

      if (currentIdx === endIdx) {
        return { path: this.reconstructPath(endIdx, parentIndex, includeStart), status: 'success', iterations };
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

        const tentativeG = currentG + weight;

        // Overflow check for Float32 safety
        if (tentativeG > FLOAT32_SAFE_LIMIT) {
             console.warn(`[Pathfinding] Cost limit exceeded at idx ${neighborIdx}. Skipping to prevent precision loss.`);
             continue;
        }

        if (tentativeG < gScore[neighborIdx]) {
          parentIndex[neighborIdx] = currentIdx;
          gScore[neighborIdx] = tentativeG;
          const f = tentativeG + (this.heuristic(neighborIdx, endIdx) * heuristicWeight);
          heap.push(neighborIdx, f, tentativeG);
        }
      }
    }
    
    if (failToClosest) {
         if (closestNodeIdx === startIdx) return { path: [], status: 'no_path', iterations };
         
         if (parentIndex[closestNodeIdx] === -1 && closestNodeIdx !== startIdx) {
             console.warn("[Pathfinding] Closest node found but has no parent. Returning no_path.");
             return { path: [], status: 'no_path', iterations };
         }
         
         return { path: this.reconstructPath(closestNodeIdx, parentIndex, includeStart), status: 'partial_path', iterations };
    }

    return { path: [], status: iterations > maxIterations ? 'timeout' : 'no_path', iterations };
  }

  private createBuffers(size: number): ComputeBuffers {
      return {
          gScore: new Float32Array(size),
          parentIndex: new Int32Array(size),
          nodeState: new Uint32Array(size),
          closedSet: new Uint32Array(size),
          heap: new FlatMinHeap(Math.max(16, (size / 4) | 0)),
          neighbors: new Int32Array(MAX_NEIGHBORS)
      };
  }

  private acquireBuffers(): ComputeBuffers {
      this.activeSearches++;
      if (this.bufferPool.length > 0) return this.bufferPool.pop()!;
      if (this.globalSearchId > 100 && this.activeSearches > this.maxPoolSize) {
          console.warn(`[Pathfinding] Pool exhausted. Active: ${this.activeSearches}.`);
      }
      return this.createBuffers(this.size * this.size);
  }

  private releaseBuffers(buffers: ComputeBuffers) {
      this.activeSearches--;
      if (this.bufferPool.length < this.maxPoolSize) this.bufferPool.push(buffers);
  }

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
    let safety = 0;
    const maxLen = this.totalTiles;

    while (curr !== -1 && safety < maxLen) {
      const gx = curr % this.size;
      const gz = (curr / this.size) | 0;
      path.push({ x: this.toWorldX(gx), z: this.toWorldZ(gz) });
      curr = parentIndex[curr];
      safety++;
    }
    
    if (safety >= maxLen) console.error(`[Pathfinding] Infinite loop in reconstructPath. EndIdx: ${endIdx}`);
    
    path.reverse(); 
    if (!includeStart && path.length > 0) path.shift();
    return path;
  }

  private fillNeighborsBuffer(idx: number, buffer: Int32Array): number {
    const size = this.size;
    const total = this.totalTiles;
    const x = idx % size; 
    let count = 0;

    if (x > 0) buffer[count++] = idx - 1;
    if (x < size - 1) buffer[count++] = idx + 1;
    if (idx >= size) buffer[count++] = idx - size;
    if (idx < total - size) buffer[count++] = idx + size;

    return count;
  }

  private toGridX(worldX: number): number {
    return (Math.floor(worldX + 0.5) + this.halfSize) | 0;
  }

  private toGridZ(worldZ: number): number {
    return (Math.floor(worldZ + 0.5) + this.halfSize) | 0;
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