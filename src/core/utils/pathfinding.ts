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

// REFERENCE: High-performance A* Pathfinding (v3.17.0)
// Improvements (v3.17.0):
// - Perf: Math.floor(x + 0.5) for fast rounding.
// - Perf: Pre-calculated cross-product constants.
// - Logic: Explicit start node initialization.
// - Safety: Stricter stale data checks.

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

// Bitmasks for NodeTags
// Structure: [SearchID (30 bits) | State (2 bits)]
const STATE_NONE = 0;
const STATE_OPEN = 1;
const STATE_CLOSED = 2;
const MAX_SEARCH_ID = 0x3FFFFFFF; // 30 bits max

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
  nodeTags: Uint32Array; // Combined ID and State
  heap: FlatMinHeap;
  neighbors: Int32Array; 
}

class FlatMinHeap {
  private indices: Int32Array;
  private f: Float32Array;
  private g: Float32Array;
  public length: number = 0;
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.indices = new Int32Array(capacity);
    this.f = new Float32Array(capacity);
    this.g = new Float32Array(capacity);
  }

  push(index: number, fVal: number, gVal: number) {
    if (this.length >= this.capacity) return;
    
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

  private bubbleUp(idx: number) {
    while (idx > 0) {
      const parentIdx = (idx - 1) >>> 1;
      const cf = this.f[idx];
      const pf = this.f[parentIdx];
      
      if (cf > pf + EPSILON) break;
      
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
  }
}

export class PathfindingService {
  private grid: Float32Array;
  private size: number = 0;
  private totalTiles: number = 0;
  private halfSize: number = 0;
  private gridVersion: number = 0;
  private minStepCost: number = COSTS.MIN_STEP;
  private globalSearchId: number = 0;
  
  // Tie-breaker state
  private startGridX: number = 0;
  private startGridZ: number = 0;
  
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

    const costs = Object.values(WEIGHT_MAP).filter(c => Number.isFinite(c));
    this.minStepCost = costs.length > 0 ? Math.min(...costs) : COSTS.MIN_STEP;

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

  public getPathKey(start: Coordinates, end: Coordinates, options: PathOptions): string {
      const sIdx = this.toIndex(start.x, start.z);
      const eIdx = this.toIndex(end.x, end.z);
      
      if (sIdx === -1 || eIdx === -1) {
          return `INV:${start.x},${start.z}->${end.x},${end.z}`;
      }

      const hWeight = options.heuristicWeight ?? 1.0;
      const safeHWeight = Math.round(hWeight * 1000) / 1000;
      const includeStart = options.includeStartNode ?? false;
      const failToClosest = options.failToClosest ?? false;
      const maxIter = options.maxIterations ?? this.defaultMaxIterations;

      return `${sIdx}-${eIdx}-${safeHWeight}-${includeStart}-${failToClosest}-${maxIter}`;
  }

  public checkCache(start: Coordinates, end: Coordinates, options: PathOptions = {}): PathResult | null {
      const cacheKey = this.getPathKey(start, end, options);
      if (cacheKey.startsWith('INV:')) return null;

      const cached = this.pathCache.get(cacheKey);
      if (cached && cached.version === this.gridVersion) {
          this.cacheHits++;
          this.pathCache.delete(cacheKey);
          this.pathCache.set(cacheKey, cached);
          return { 
            path: [...cached.path], 
            status: 'success',
            metrics: { iterations: 0, duration: 0, cached: true, cacheHits: this.cacheHits, cacheMisses: this.cacheMisses } 
          };
      }
      return null;
  }

  public findPathSync(
      start: Coordinates, 
      end: Coordinates, 
      options: PathOptions = {}
  ): PathResult {
    const startTime = performance.now();
    const cacheKey = this.getPathKey(start, end, options);
    
    if (!cacheKey.startsWith('INV:')) {
        const cached = this.pathCache.get(cacheKey);
        if (cached && cached.version === this.gridVersion) {
            this.cacheHits++;
            this.pathCache.delete(cacheKey);
            this.pathCache.set(cacheKey, cached);
            return { path: [...cached.path], status: 'success', metrics: { iterations: 0, duration: 0, cached: true } };
        }
    }

    if (options.signal?.aborted) return { path: [], status: 'aborted' };

    const sIdx = this.toIndex(start.x, start.z);
    const eIdx = this.toIndex(end.x, end.z);
    
    if (sIdx === -1 || eIdx === -1) return { path: [], status: 'invalid_args' };
    
    this.startGridX = this.toGridX(start.x);
    this.startGridZ = this.toGridZ(start.z);

    const includeStart = options.includeStartNode ?? false;
    if (sIdx === eIdx) {
        const path = includeStart ? [{ ...end }] : [];
        return { path, status: 'success', metrics: { iterations: 0, duration: 0 } };
    }
    
    const failToClosest = options.failToClosest ?? false;
    if (!Number.isFinite(this.grid[sIdx])) return { path: [], status: 'no_path' };
    if (!failToClosest && !Number.isFinite(this.grid[eIdx])) return { path: [], status: 'no_path' };

    this.cacheMisses++;
    const buffers = this.acquireBuffers();
    const safetyLimit = Math.max(this.totalTiles * 2, 50000);
    const maxIter = Math.min(options.maxIterations ?? this.defaultMaxIterations, safetyLimit);
    const hWeight = options.heuristicWeight ?? 1.0;

    try {
        const result = this.calculateAStar(
            sIdx, eIdx, maxIter, hWeight, includeStart, failToClosest, 
            buffers, options.signal
        );
        const duration = performance.now() - startTime;
        
        if (result.status === 'success' && !cacheKey.startsWith('INV:')) {
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

  public async findPath(start: Coordinates, end: Coordinates, options: PathOptions = {}): Promise<PathResult> {
      return this.findPathSync(start, end, options);
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
    const { gScore, parentIndex, nodeTags, heap, neighbors } = buffers;

    this.globalSearchId++;
    if (this.globalSearchId >= MAX_SEARCH_ID) {
        this.globalSearchId = 1;
        nodeTags.fill(0);
        gScore.fill(Infinity);
        parentIndex.fill(-1);
    }
    const currentId = this.globalSearchId;

    heap.clear();
    
    // Explicit initialization for start node
    gScore[startIdx] = 0;
    parentIndex[startIdx] = -1;
    nodeTags[startIdx] = (currentId << 2) | STATE_OPEN;
    
    const size = this.size;
    const sx = startIdx % size;
    const sz = (startIdx / size) | 0;
    const ex = endIdx % size;
    const ez = (endIdx / size) | 0;
    const initH = (Math.abs(sx - ex) + Math.abs(sz - ez)) * this.minStepCost;

    heap.push(startIdx, initH * heuristicWeight, 0);

    let iterations = 0;
    let closestNodeIdx = startIdx;
    let minH = Infinity;

    // Tie-Breaker Constants (Pre-calculated)
    const startGX = this.startGridX;
    const startGZ = this.startGridZ;
    const minStep = this.minStepCost;
    const dx1 = ex - startGX;
    const dz1 = ez - startGZ;

    while (!heap.isEmpty()) {
      iterations++;
      if (signal?.aborted) return { path: [], status: 'aborted', iterations };
      if (iterations > maxIterations) break; 

      const current = heap.pop()!;
      const currentIdx = current.index;
      
      const tagVal = nodeTags[currentIdx];
      const tagId = tagVal >>> 2;
      const tagState = tagVal & 3;

      if (tagId === currentId) {
          if (tagState === STATE_CLOSED) continue;
          if (current.g > gScore[currentIdx]) continue;
      }
      
      if (failToClosest) {
          const cX = currentIdx % size;
          const cZ = (currentIdx / size) | 0;
          const h = (Math.abs(cX - ex) + Math.abs(cZ - ez)) * minStep;
          if (h < minH) {
              minH = h;
              closestNodeIdx = currentIdx;
          }
      }

      nodeTags[currentIdx] = (currentId << 2) | STATE_CLOSED;

      if (currentIdx === endIdx) {
        return { 
          path: this.reconstructPath(endIdx, parentIndex, includeStart, nodeTags, currentId), 
          status: 'success', 
          iterations 
        };
      }

      const count = this.fillNeighborsBuffer(currentIdx, neighbors);
      
      for (let i = 0; i < count; i++) {
        const neighborIdx = neighbors[i];
        
        const nTag = nodeTags[neighborIdx];
        if ((nTag >>> 2) === currentId && (nTag & 3) === STATE_CLOSED) continue;
        
        const weight = this.grid[neighborIdx];
        if (!Number.isFinite(weight)) continue;

        if ((nTag >>> 2) !== currentId) {
            gScore[neighborIdx] = Infinity;
            parentIndex[neighborIdx] = -1;
        }

        const tentativeG = current.g + weight;
        if (tentativeG > FLOAT32_SAFE_LIMIT) continue;

        if (tentativeG < gScore[neighborIdx]) {
          parentIndex[neighborIdx] = currentIdx;
          gScore[neighborIdx] = tentativeG;
          
          const nx = neighborIdx % size;
          const nz = (neighborIdx / size) | 0;
          
          let h = (Math.abs(nx - ex) + Math.abs(nz - ez)) * minStep;
          
          // Optimized Tie-Breaking
          const dx2 = nx - startGX;
          const dz2 = nz - startGZ;
          const cross = Math.abs(dx1 * dz2 - dx2 * dz1);
          h += cross * 0.00001;

          const f = tentativeG + (h * heuristicWeight);
          
          heap.push(neighborIdx, f, tentativeG);
          
          nodeTags[neighborIdx] = (currentId << 2) | STATE_OPEN;
        }
      }
    }
    
    if (failToClosest) {
         if (closestNodeIdx === startIdx) return { path: [], status: 'no_path', iterations };
         
         // Fallback: If parent not set (stale), try to find ANY closed path to it?
         // Since we enforce strict ID check in reconstructPath, simply calling it is safe.
         // If it fails, it returns partial path or empty.
         return { 
             path: this.reconstructPath(closestNodeIdx, parentIndex, includeStart, nodeTags, currentId), 
             status: 'partial_path', 
             iterations 
         };
    }

    return { path: [], status: iterations > maxIterations ? 'timeout' : 'no_path', iterations };
  }

  private createBuffers(size: number): ComputeBuffers {
      return {
          gScore: new Float32Array(size),
          parentIndex: new Int32Array(size),
          nodeTags: new Uint32Array(size), 
          heap: new FlatMinHeap(size),
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

  private reconstructPath(
    endIdx: number, 
    parentIndex: Int32Array, 
    includeStart: boolean,
    nodeTags: Uint32Array,
    searchId: number
  ): Coordinates[] {
    const path: Coordinates[] = [];
    let curr = endIdx;
    let safety = 0;
    const maxLen = this.totalTiles;
    const size = this.size;
    const halfSize = this.halfSize;

    while (curr !== -1 && safety < maxLen) {
      const tagVal = nodeTags[curr];
      const tagId = tagVal >>> 2;
      
      if (tagId !== searchId) {
          break;
      }

      const gx = curr % size;
      const gz = (curr / size) | 0;
      path.push({ x: gx - halfSize, z: gz - halfSize });
      curr = parentIndex[curr];
      safety++;
    }
    
    if (safety >= maxLen) console.error(`[Pathfinding] Infinite loop in reconstructPath.`);
    
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
    return Math.floor(worldX + 0.5) + this.halfSize;
  }

  private toGridZ(worldZ: number): number {
    return Math.floor(worldZ + 0.5) + this.halfSize;
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