
import { TileData, TileType } from '../../entities/Map';
import { Coordinates } from '../../shared/types';

// REFERENCE: High-performance A* Pathfinding (v2.1)
// Mirroring the structure, error handling, and memory optimization guidelines.

const COSTS = {
  OBSTACLE: 0,
  ROAD: 0.5,
  GRASS: 1.0,
  FOREST: 1.5,
  MIN_STEP: 0.5 // COSTS.ROAD
} as const;

export type NavigationLayer = TileType | 'ROAD' | 'BUILDING';

interface HeapNode {
  index: number;
  f: number;
  g: number;
}

/**
 * MinHeap Implementation for high-performance Priority Queue.
 * Optimized for A* pathfinding.
 */
class MinHeap {
  private heap: HeapNode[] = [];
  
  push(node: HeapNode) {
    this.heap.push(node);
    this.bubbleUp();
  }
  
  pop(): HeapNode | undefined {
    if (this.size() === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.size() > 0) {
      this.heap[0] = last;
      this.sinkDown();
    }
    return top;
  }
  
  isEmpty() { return this.heap.length === 0; }
  size() { return this.heap.length; }

  private bubbleUp() {
    let idx = this.heap.length - 1;
    while (idx > 0) {
      let parentIdx = Math.floor((idx - 1) / 2);
      if (this.heap[idx].f >= this.heap[parentIdx].f) break;
      [this.heap[idx], this.heap[parentIdx]] = [this.heap[parentIdx], this.heap[idx]];
      idx = parentIdx;
    }
  }

  private sinkDown() {
    let idx = 0;
    while (true) {
      let left = 2 * idx + 1;
      let right = 2 * idx + 2;
      let smallest = idx;
      if (left < this.heap.length && this.heap[left].f < this.heap[smallest].f) smallest = left;
      if (right < this.heap.length && this.heap[right].f < this.heap[smallest].f) smallest = right;
      if (smallest === idx) break;
      [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
      idx = smallest;
    }
  }
}

/**
 * High-performance Pathfinding Service.
 * Uses 1D Float32Array for memory efficiency and O(1) access.
 * Decoupled from rendering logic.
 */
export class PathfindingService {
  private grid: Float32Array;
  private size: number = 0;
  private halfSize: number = 0;
  private gridVersion: number = 0;
  private pathCache: Map<string, { path: Coordinates[]; version: number }> = new Map();
  
  // Reusable buffers to minimize GC pressure
  private gScore!: Float32Array;
  private parentIndex!: Int32Array;
  private visited!: Uint8Array;
  private maxIterations: number = 5000;

  constructor() {
    this.grid = new Float32Array(0);
  }

  /**
   * Initializes the navigation grid from the game state.
   */
  public syncWithStore(tiles: TileData[], size: number): void {
    this.size = size;
    this.halfSize = Math.floor(size / 2);
    const totalTiles = size * size;
    
    // Allocate buffers once
    this.grid = new Float32Array(totalTiles);
    this.gScore = new Float32Array(totalTiles);
    this.parentIndex = new Int32Array(totalTiles);
    this.visited = new Uint8Array(totalTiles);
    
    // Default to OBSTACLE for safety
    this.grid.fill(COSTS.OBSTACLE);

    tiles.forEach(tile => {
      const idx = this.toIndex(tile.x, tile.z);
      if (idx !== -1) {
          let weight = this.getWeightByType(tile.type);
          if (tile.occupiedBy) weight = COSTS.OBSTACLE;
          this.grid[idx] = weight;
      }
    });

    this.gridVersion++;
    this.pathCache.clear();
  }

  /**
   * Updates a single node's walkability.
   * O(1) complexity. Invalidates cache lazily via versioning.
   */
  public updateNode(x: number, z: number, type: NavigationLayer): void {
    const idx = this.toIndex(x, z);
    if (idx === -1) return;
    
    const weight = this.getWeightByType(type);
    
    if (this.grid[idx] !== weight) {
       this.grid[idx] = weight;
       this.gridVersion++;
    }
  }

  /**
   * Checks if a tile is walkable.
   * Useful for fast exits before calculating paths.
   */
  public isWalkable(x: number, z: number): boolean {
    const idx = this.toIndex(x, z);
    if (idx === -1) return false;
    return this.grid[idx] !== COSTS.OBSTACLE;
  }

  /**
   * Async A* Pathfinding.
   */
  public async findPath(start: Coordinates, end: Coordinates): Promise<Coordinates[]> {
    const sIdx = this.toIndex(start.x, start.z);
    const eIdx = this.toIndex(end.x, end.z);

    // Fail Fast: Out of bounds or same position
    if (sIdx === -1 || eIdx === -1) return [];
    if (sIdx === eIdx) return [];

    // Fail Fast: Start or End is unreachable
    if (this.grid[sIdx] === COSTS.OBSTACLE || this.grid[eIdx] === COSTS.OBSTACLE) return [];

    const cacheKey = `${sIdx}-${eIdx}`;
    const cached = this.pathCache.get(cacheKey);
    if (cached && cached.version === this.gridVersion) return cached.path;

    const result = this.calculateAStar(sIdx, eIdx);
    
    if (result.length > 0) {
      this.pathCache.set(cacheKey, { path: result, version: this.gridVersion });
    }
    
    return result;
  }

  private calculateAStar(startIdx: number, endIdx: number): Coordinates[] {
    // Reset buffers
    this.gScore.fill(Infinity);
    this.parentIndex.fill(-1);
    this.visited.fill(0);
    
    const openSet = new MinHeap();
    
    this.gScore[startIdx] = 0;
    openSet.push({ index: startIdx, f: this.heuristic(startIdx, endIdx), g: 0 });

    let iterations = 0;

    while (!openSet.isEmpty() && iterations < this.maxIterations) {
      iterations++;
      const current = openSet.pop()!;

      // Lazy Deletion: Skip if we found a better path to this node already
      if (current.g > this.gScore[current.index]) continue;
      if (this.visited[current.index]) continue;
      
      this.visited[current.index] = 1;

      if (current.index === endIdx) {
        return this.reconstructPath(endIdx);
      }

      for (const neighborIdx of this.getNeighbors(current.index)) {
        if (this.visited[neighborIdx]) continue;
        
        const weight = this.grid[neighborIdx];
        if (weight === COSTS.OBSTACLE) continue;

        const tentativeG = current.g + weight;

        if (tentativeG < this.gScore[neighborIdx]) {
          this.parentIndex[neighborIdx] = current.index;
          this.gScore[neighborIdx] = tentativeG;
          const f = tentativeG + this.heuristic(neighborIdx, endIdx);
          openSet.push({ index: neighborIdx, f, g: tentativeG });
        }
      }
    }

    return [];
  }

  private heuristic(aIdx: number, bIdx: number): number {
    const ax = aIdx % this.size;
    const az = Math.floor(aIdx / this.size);
    const bx = bIdx % this.size;
    const bz = Math.floor(bIdx / this.size);
    // Admissible heuristic: Manhattan scaled by MIN_STEP cost
    return (Math.abs(ax - bx) + Math.abs(az - bz)) * COSTS.MIN_STEP;
  }

  private reconstructPath(endIdx: number): Coordinates[] {
    const path: Coordinates[] = [];
    let curr = endIdx;
    
    // Build path backwards, excluding the start node
    while (this.parentIndex[curr] !== -1) {
      const gx = curr % this.size;
      const gz = Math.floor(curr / this.size);
      
      // Convert back to world coordinates
      path.push({ 
        x: gx - this.halfSize, 
        z: gz - this.halfSize 
      });
      
      curr = this.parentIndex[curr];
    }
    
    return path.reverse();
  }

  private getNeighbors(idx: number): number[] {
    const x = idx % this.size;
    const z = Math.floor(idx / this.size);
    const res: number[] = [];

    if (x > 0) res.push(idx - 1);
    if (x < this.size - 1) res.push(idx + 1);
    if (z > 0) res.push(idx - this.size);
    if (z < this.size - 1) res.push(idx + this.size);

    return res;
  }

  private toIndex(worldX: number, worldZ: number): number {
    // Using Math.round because tiles are centered at integer coordinates (0,0) ranges [-0.5, 0.5]
    // Math.round ensures we pick the nearest tile center.
    const gx = Math.round(worldX) + this.halfSize;
    const gz = Math.round(worldZ) + this.halfSize;
    
    if (gx < 0 || gx >= this.size || gz < 0 || gz >= this.size) return -1;
    return gz * this.size + gx;
  }

  private getWeightByType(type: string): number {
    switch (type.toUpperCase()) {
      case 'ROAD': return COSTS.ROAD;
      case 'FOREST': return COSTS.FOREST;
      case 'WATER': 
      case 'MOUNTAIN': 
      case 'BUILDING': return COSTS.OBSTACLE;
      default: return COSTS.GRASS;
    }
  }
}

export const pathfindingService = new PathfindingService();
