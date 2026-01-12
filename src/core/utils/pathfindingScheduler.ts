/**
 * @module Core/PathfindingScheduler
 * @layer Core
 * @description Планировщик задач поиска пути (Time-Slicing).
 * Управляет очередью запросов на A*, распределяя нагрузку по кадрам.
 * Гарантирует стабильный FPS даже при массовом перемещении юнитов.
 */

import { Coordinates } from '../../shared/types';
import { PathfindingService, PathOptions, PathResult, pathfindingService } from './pathfinding';

export enum Priority {
  HIGH = 0,   // Player clicks (Immediate feedback)
  MEDIUM = 1, // Worker AI / Unit spawning
  LOW = 2     // Background updates / Idle wandering
}

interface PathRequest {
  key: string; 
  start: Coordinates;
  end: Coordinates;
  options: PathOptions;
  priority: Priority;
  promise: Promise<PathResult>;
  resolve: (value: PathResult) => void;
  reject: (reason?: any) => void;
  timestamp: number;
}

const MAX_QUEUE_SIZE = 1000;
const MAX_WAIT_TIME = 2000; 

class PathfindingScheduler {
  private queues: Map<Priority, PathRequest[]>;
  private service: PathfindingService;
  
  // Deduplication map: Key -> Request Object
  private pendingRequests: Map<string, PathRequest> = new Map();
  
  // Debug metrics
  private processedCount = 0;
  private droppedCount = 0;
  private totalWaitTime = 0;
  private processedWaitCount = 0;

  constructor(service: PathfindingService) {
    this.service = service;
    this.queues = new Map();
    this.queues.set(Priority.HIGH, []);
    this.queues.set(Priority.MEDIUM, []);
    this.queues.set(Priority.LOW, []);
  }

  public requestPath(
    start: Coordinates, 
    end: Coordinates, 
    priority: Priority = Priority.MEDIUM,
    options: PathOptions = {}
  ): Promise<PathResult> {
    
    // 1. Synchronous Cache Check
    const cached = this.service.checkCache(start, end, options);
    if (cached) {
      return Promise.resolve(cached);
    }
    
    // 2. Key Generation
    const key = this.service.getPathKey(start, end, options);
    
    // 3. Deduplication with Priority Upgrade
    const existing = this.pendingRequests.get(key);
    if (existing) {
        if (priority < existing.priority) {
            // Upgrade Priority
            // Remove from old queue
            const oldQueue = this.queues.get(existing.priority);
            if (oldQueue) {
                const idx = oldQueue.indexOf(existing);
                if (idx !== -1) oldQueue.splice(idx, 1);
            }
            
            // Update priority and push to new queue
            existing.priority = priority;
            this.queues.get(priority)?.push(existing);
        }
        return existing.promise;
    }

    // 4. Enqueue Request
    let resolveFn!: (value: PathResult) => void;
    let rejectFn!: (reason?: any) => void;
    
    const promise = new Promise<PathResult>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
    });

    // Queue Limit & Drop Policy
    // Policy: Never drop HIGH. Only drop LOW if queue full.
    const totalSize = this.getTotalQueueSize();
    if (totalSize >= MAX_QUEUE_SIZE) {
        if (priority === Priority.HIGH) {
            // Force squeeze: drop LOW to make room for HIGH
            this.dropLowPriorityBatch(5);
        } else if (priority === Priority.MEDIUM) {
             // Drop LOW to make room
             if (!this.dropLowPriorityBatch(1)) {
                 // If no LOW items, drop new MEDIUM (reject)
                 return Promise.reject(new Error("Queue full"));
             }
        } else {
            // LOW priority, just reject
            this.droppedCount++;
            return Promise.reject(new Error("Queue full"));
        }
    }

    const request: PathRequest = {
        key,
        start,
        end,
        options,
        priority,
        promise,
        resolve: resolveFn,
        reject: rejectFn,
        timestamp: performance.now()
    };

    this.queues.get(priority)?.push(request);
    this.pendingRequests.set(key, request);
    
    return promise;
  }

  public processQueue(budgetMs: number = 2): void {
    const startTime = performance.now();
    let processed = 0;

    // Round-Robin / Priority Processing
    // We iterate priorities but maintain budget check strictly.
    // HIGH is processed first, but we ensure we check budget.
    const priorities = [Priority.HIGH, Priority.MEDIUM, Priority.LOW];

    for (const priority of priorities) {
      const queue = this.queues.get(priority)!;

      while (queue.length > 0) {
        if (performance.now() - startTime > budgetMs) return;

        const request = queue[0];
        
        // --- Aging Check (Skip for HIGH) ---
        if (priority !== Priority.HIGH && performance.now() - request.timestamp > MAX_WAIT_TIME) {
            queue.shift(); 
            request.reject(new Error("Request Timed Out (Aging)"));
            this.pendingRequests.delete(request.key);
            this.droppedCount++;
            continue;
        }

        if (request.options.signal?.aborted) {
            queue.shift();
            request.reject(new Error("Aborted"));
            this.pendingRequests.delete(request.key);
            continue;
        }

        try {
            const result = this.service.findPathSync(request.start, request.end, request.options);
            queue.shift();
            request.resolve(result);
            processed++;
        } catch (e) {
            queue.shift();
            request.reject(e);
        } finally {
            if (this.pendingRequests.get(request.key) === request) {
                this.pendingRequests.delete(request.key);
            }
        }
      }
    }
    
    if (processed > 0) this.processedCount += processed;
  }

  private dropLowPriorityBatch(count: number): boolean {
      const lowQueue = this.queues.get(Priority.LOW)!;
      if (lowQueue.length === 0) return false;
      
      const toDrop = Math.min(count, lowQueue.length);
      for (let i = 0; i < toDrop; i++) {
          const dropped = lowQueue.shift();
          if (dropped) {
              dropped.reject(new Error("Dropped for priority"));
              this.pendingRequests.delete(dropped.key);
              this.droppedCount++;
          }
      }
      return true;
  }

  private getTotalQueueSize(): number {
      return (this.queues.get(Priority.HIGH)?.length || 0) +
             (this.queues.get(Priority.MEDIUM)?.length || 0) +
             (this.queues.get(Priority.LOW)?.length || 0);
  }
}

export const pathfindingScheduler = new PathfindingScheduler(pathfindingService);