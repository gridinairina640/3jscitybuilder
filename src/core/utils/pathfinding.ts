
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

/**
 * MinHeap Implementation for high-performance Priority Queue.
 * Essential for A* speed (O(log n) insertions/removals).
 */
class MinHeap<T> {
  private heap: T[];
  private scoreFunction: (item: T) => number;

  constructor(scoreFunction: (item: T) => number) {
    this.heap = [];
    this.scoreFunction = scoreFunction;
  }

  push(node: T) {
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
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
 */
class PathfindingService {
  private width: number = 0;
  private height: number = 0;
  private grid: Float32Array = new Float32Array(0); // Stores weights
  private cache: Map<string, Coordinates[]> = new Map();

  /**
   * Initializes the navigation grid from the game state.
   */
  public syncWithStore(tiles: TileData[], size: number) {
    this.width = size;
    this.height = size;
    this.grid = new Float32Array(size * size);
    this.cache.clear();

    // Populate grid
    tiles.forEach(tile => {
      // Offset coordinates to array index (assuming map is centered 0,0)
      // Map coordinates: -size/2 to size/2
      // Array coordinates: 0 to size
      const arrayX = tile.x + size / 2;
      const arrayZ = tile.z + size / 2;
      
      if (arrayX >= 0 && arrayX < size && arrayZ >= 0 && arrayZ < size) {
        const index = arrayZ * size + arrayX;
        this.grid[index] = this.getCostFromType(tile.type);
        
        // If occupied, mark as obstacle (unless we add dynamic unit collision later)
        if (tile.occupiedBy) {
          // We can check entity type here if needed, for now assume all buildings are obstacles
          // But logic might be handled via updateNode separately
           this.grid[index] = COSTS.OBSTACLE;
        }
      }
    });
  }

  /**
   * Updates a single node's walkability.
   * O(1) complexity.
   */
  public updateNode(x: number, z: number, type: NavigationLayer) {
    const arrayX = x + this.width / 2;
    const arrayZ = z + this.height / 2;

    if (this.isValid(arrayX, arrayZ)) {
      const index = arrayZ * this.width + arrayX;
      let weight = COSTS.GRASS;

      if (type === 'ROAD') weight = COSTS.ROAD;
      else if (type === 'BUILDING') weight = COSTS.OBSTACLE;
      else weight = this.getCostFromType(type as TileType);

      this.grid[index] = weight;
      
      // Invalidate relevant cache entries (naive approach: clear all)
      // For a better approach, we'd only clear paths passing through this node, 
      // but that's expensive to track.
      this.cache.clear(); 
    }
  }

  /**
   * Checks if a tile is walkable.
   * Useful for fast exits before calculating paths.
   */
  public isWalkable(x: number, z: number): boolean {
    const arrayX = x + this.width / 2;
    const arrayZ = z + this.height / 2;
    
    if (!this.isValid(arrayX, arrayZ)) return false;
    
    const index = arrayZ * this.width + arrayX;
    return this.grid[index] !== COSTS.OBSTACLE && this.grid[index] !== Infinity;
  }

  /**
   * Async A* Pathfinding.
   * Returns a promise to allow future offloading to Web Workers.
   */
  public async findPath(start: Coordinates, end: Coordinates): Promise<Coordinates[]> {
    const key = `${start.x},${start.z}:${end.x},${end.z}`;
    
    // 1. Check LRU Cache
    if (this.cache.has(key)) {
      // Refresh key position for LRU
      const path = this.cache.get(key)!;
      this.cache.delete(key);
      this.cache.set(key, path);
      return path;
    }

    // Convert world coords to grid coords
    const sx = Math.round(start.x + this.width / 2);
    const sz = Math.round(start.z + this.height / 2);
    const ex = Math.round(end.x + this.width / 2);
    const ez = Math.round(end.z + this.height / 2);

    // Boundary / Validity Checks
    if (!this.isValid(sx, sz) || !this.isValid(ex, ez)) return [];
    
    const startIndex = sz * this.width + sx;
    const endIndex = ez * this.width + ex;

    // Check if end is reachable
    if (this.grid[endIndex] === COSTS.OBSTACLE) return [];

    // --- A* Algorithm ---
    const openSet = new MinHeap<{ index: number; f: number }>(n => n.f);
    const cameFrom = new Map<number, number>(); // Child Index -> Parent Index
    const gScore = new Map<number, number>(); // Index -> Cost

    gScore.set(startIndex, 0);
    openSet.push({ index: startIndex, f: this.heuristic(sx, sz, ex, ez) });

    const visited = new Set<number>();

    while (openSet.size() > 0) {
      const current = openSet.pop();
      if (!current) break;
      const currentIndex = current.index;

      if (currentIndex === endIndex) {
        const path = this.reconstructPath(cameFrom, currentIndex);
        this.addToCache(key, path);
        return path;
      }

      visited.add(currentIndex);

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
        if (!this.isValid(neighbor.x, neighbor.z)) continue;
        
        const neighborIndex = neighbor.z * this.width + neighbor.x;
        const weight = this.grid[neighborIndex];

        if (weight === COSTS.OBSTACLE) continue;
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

  // --- Helpers ---

  private isValid(x: number, z: number): boolean {
    return x >= 0 && x < this.width && z >= 0 && z < this.height;
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
      // Convert back to world coordinates
      path.push({ x: x - this.width / 2, z: z - this.height / 2 });
      curr = cameFrom.get(curr)!;
    }
    
    // Optional: Add start node? Usually movement systems want the *next* step, not where I am.
    // path.push({ x: ... }) 

    return path.reverse();
  }

  private addToCache(key: string, path: Coordinates[]) {
    if (this.cache.size >= CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, path);
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
