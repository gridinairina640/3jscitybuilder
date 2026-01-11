
import { TileData, TileType } from '../../entities/Map';
import { Coordinates } from '../../shared/types';

// --- Configuration ---
const COSTS = {
  ROAD: 0.5,
  GRASS: 1.0,
  FOREST: 2.0,
  OBSTACLE: Infinity
};

const CACHE_SIZE = 100;

export type NavigationLayer = TileType | 'ROAD' | 'BUILDING';

interface CacheEntry {
  path: Coordinates[];
  version: number;
}

interface HeapNode {
  index: number;
  f: number;
}

/**
 * MinHeap Implementation for high-performance Priority Queue.
 * Optimized for A* pathfinding.
 */
class MinHeap {
  private heap: HeapNode[];
  private scoreFunction: (item: HeapNode) => number;

  constructor(scoreFunction: (item: HeapNode) => number) {
    this.heap = [];
    this.scoreFunction = scoreFunction;
  }

  push(node: HeapNode) {
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): HeapNode | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0 && bottom !== undefined) {
      this.heap[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  size() {
    return this.heap.length;
  }

  private bubbleUp(n: number) {
    const element = this.heap[n];
    const score = this.scoreFunction(element);
    
    while (n > 0) {
      const parentN = Math.floor((n + 1) / 2) - 1;
      const parent = this.heap[parentN];
      if (score >= this.scoreFunction(parent)) break;
      
      this.heap[parentN] = element;
      this.heap[n] = parent;
      n = parentN;
    }
  }

  private sinkDown(n: number) {
    const length = this.heap.length;
    const element = this.heap[n];
    const elemScore = this.scoreFunction(element);

    while (true) {
      const child2N = (n + 1) * 2;
      const child1N = child2N - 1;
      let swap = null;
      let child1Score = 0;

      if (child1N < length) {
        const child1 = this.heap[child1N];
        child1Score = this.scoreFunction(child1);
        if (child1Score < elemScore) swap = child1N;
      }

      if (child2N < length) {
        const child2 = this.heap[child2N];
        const child2Score = this.scoreFunction(child2);
        if (child2Score < (swap === null ? elemScore : child1Score)) swap = child2N;
      }

      if (swap === null) break;
      
      this.heap[n] = this.heap[swap];
      this.heap[swap] = element;
      n = swap;
    }
  }
}

/**
 * High-performance Pathfinding Service.
 * Uses 1D Float32Array for memory efficiency and O(1) access.
 * Decoupled from rendering logic.
 */
class PathfindingService {
  private width: number = 0;
  private height: number = 0;
  private halfSize: number = 0;
  
  private grid: Float32Array = new Float32Array(0); // Stores weights
  private cache: Map<string, CacheEntry> = new Map();
  private gridVersion: number = 0; // Increments on every map change

  /**
   * Initializes the navigation grid from the game state.
   */
  public syncWithStore(tiles: TileData[], size: number) {
    this.width = size;
    this.height = size;
    this.halfSize = Math.floor(size / 2);
    this.grid = new Float32Array(size * size);
    this.cache.clear();
    this.gridVersion = 1;

    // Default init to Obstacle to catch out-of-bounds errors inside the array range
    this.grid.fill(COSTS.OBSTACLE);

    tiles.forEach(tile => {
      const arrayX = this.toGridX(tile.x);
      const arrayZ = this.toGridZ(tile.z);
      
      if (this.isValidGridIndex(arrayX, arrayZ)) {
        const index = this.toIndex(arrayX, arrayZ);
        
        let weight = this.getCostFromType(tile.type);
        if (tile.occupiedBy) {
           weight = COSTS.OBSTACLE;
        }
        
        this.grid[index] = weight;
      }
    });
  }

  /**
   * Updates a single node's walkability.
   * O(1) complexity. Invalidates cache lazily via versioning.
   */
  public updateNode(x: number, z: number, type: NavigationLayer) {
    const arrayX = this.toGridX(x);
    const arrayZ = this.toGridZ(z);

    if (this.isValidGridIndex(arrayX, arrayZ)) {
      const index = this.toIndex(arrayX, arrayZ);
      let weight = COSTS.GRASS;

      if (type === 'ROAD') weight = COSTS.ROAD;
      else if (type === 'BUILDING') weight = COSTS.OBSTACLE;
      else weight = this.getCostFromType(type as TileType);

      // Only update and bump version if weight actually changed
      if (this.grid[index] !== weight) {
        this.grid[index] = weight;
        this.gridVersion++; 
      }
    }
  }

  /**
   * Checks if a tile is walkable.
   * Useful for fast exits before calculating paths.
   */
  public isWalkable(x: number, z: number): boolean {
    const arrayX = this.toGridX(x);
    const arrayZ = this.toGridZ(z);
    
    if (!this.isValidGridIndex(arrayX, arrayZ)) return false;
    
    const index = this.toIndex(arrayX, arrayZ);
    return Number.isFinite(this.grid[index]);
  }

  /**
   * Async A* Pathfinding.
   */
  public async findPath(start: Coordinates, end: Coordinates): Promise<Coordinates[]> {
    const key = `${start.x},${start.z}:${end.x},${end.z}`;
    
    // 1. Check LRU Cache with Version Validation
    if (this.cache.has(key)) {
      const entry = this.cache.get(key)!;
      if (entry.version === this.gridVersion) {
        // Refresh LRU position
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.path;
      } else {
        // Stale entry
        this.cache.delete(key);
      }
    }

    const sx = this.toGridX(start.x);
    const sz = this.toGridZ(start.z);
    const ex = this.toGridX(end.x);
    const ez = this.toGridZ(end.z);

    // Boundary / Validity Checks
    if (!this.isValidGridIndex(sx, sz) || !this.isValidGridIndex(ex, ez)) return [];
    
    const startIndex = this.toIndex(sx, sz);
    const endIndex = this.toIndex(ex, ez);

    // Check if end is reachable
    if (!Number.isFinite(this.grid[endIndex])) return [];

    // --- A* Algorithm ---
    const openSet = new MinHeap(n => n.f);
    const cameFrom = new Map<number, number>(); 
    const gScore = new Map<number, number>(); 

    gScore.set(startIndex, 0);
    openSet.push({ index: startIndex, f: this.heuristic(sx, sz, ex, ez) });

    const visited = new Set<number>();

    while (openSet.size() > 0) {
      const current = openSet.pop();
      if (!current) break;
      
      const currentIndex = current.index;

      // Lazy Deletion / Duplicate Handling:
      // If we found a path to this node that is shorter than what's recorded 
      // when this node was pushed to heap, we've already processed it.
      // However, since we don't store "what f was pushed", we check against known gScore.
      // If current G is worse than what we already know, skip.
      // Note: We calculate current G indirectly or rely on visited for simple graphs.
      if (visited.has(currentIndex)) continue;
      visited.add(currentIndex);

      if (currentIndex === endIndex) {
        const path = this.reconstructPath(cameFrom, currentIndex);
        this.addToCache(key, path);
        return path;
      }

      const cx = currentIndex % this.width;
      const cz = Math.floor(currentIndex / this.width);

      // Neighbors (Up, Down, Left, Right)
      const neighbors = [
        { x: cx, z: cz - 1 },
        { x: cx, z: cz + 1 },
        { x: cx - 1, z: cz },
        { x: cx + 1, z: cz }
      ];

      for (const neighbor of neighbors) {
        if (!this.isValidGridIndex(neighbor.x, neighbor.z)) continue;
        
        const neighborIndex = this.toIndex(neighbor.x, neighbor.z);
        const weight = this.grid[neighborIndex];

        // Robust finite check
        if (!Number.isFinite(weight)) continue;
        if (visited.has(neighborIndex)) continue;

        const tentativeG = (gScore.get(currentIndex) || 0) + weight;

        if (tentativeG < (gScore.get(neighborIndex) ?? Infinity)) {
          cameFrom.set(neighborIndex, currentIndex);
          gScore.set(neighborIndex, tentativeG);
          
          const f = tentativeG + this.heuristic(neighbor.x, neighbor.z, ex, ez);
          openSet.push({ index: neighborIndex, f });
        }
      }
    }

    return []; // No path found
  }

  // --- Coordinate & Helper Methods ---

  private toGridX(worldX: number): number {
    return Math.floor(worldX) + this.halfSize;
  }

  private toGridZ(worldZ: number): number {
    return Math.floor(worldZ) + this.halfSize;
  }

  private toWorldX(gridX: number): number {
    return gridX - this.halfSize;
  }

  private toWorldZ(gridZ: number): number {
    return gridZ - this.halfSize;
  }

  private toIndex(gridX: number, gridZ: number): number {
    return gridZ * this.width + gridX;
  }

  private isValidGridIndex(gx: number, gz: number): boolean {
    return gx >= 0 && gx < this.width && gz >= 0 && gz < this.height;
  }

  private heuristic(x1: number, z1: number, x2: number, z2: number): number {
    // Manhattan distance
    return Math.abs(x1 - x2) + Math.abs(z1 - z2);
  }

  private reconstructPath(cameFrom: Map<number, number>, current: number): Coordinates[] {
    const path: Coordinates[] = [];
    let curr = current;

    while (cameFrom.has(curr)) {
      const x = curr % this.width;
      const z = Math.floor(curr / this.width);
      
      path.push({ 
        x: this.toWorldX(x), 
        z: this.toWorldZ(z) 
      });
      
      curr = cameFrom.get(curr)!;
    }
    
    // Note: We exclude the start node. The unit is already there.
    // The first element of the returned array is the *next* step.
    return path.reverse();
  }

  private addToCache(key: string, path: Coordinates[]) {
    if (this.cache.size >= CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    // Store with current grid version
    this.cache.set(key, { path, version: this.gridVersion });
  }

  private getCostFromType(type: TileType): number {
    switch (type) {
      case TileType.GRASS: return COSTS.GRASS;
      case TileType.FOREST: return COSTS.FOREST;
      case TileType.WATER: return COSTS.OBSTACLE;
      case TileType.MOUNTAIN: return COSTS.OBSTACLE;
      default: return COSTS.GRASS;
    }
  }
}

export const pathfindingService = new PathfindingService();
