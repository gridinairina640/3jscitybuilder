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
  key: string; // Deduplication key
  start: Coordinates;
  end: Coordinates;
  options: PathOptions;
  priority: Priority;
  resolve: (value: PathResult) => void;
  reject: (reason?: any) => void;
  timestamp: number;
}

const MAX_QUEUE_SIZE = 1000;
const MAX_WAIT_TIME = 2000; // 2 seconds

class PathfindingScheduler {
  private queues: Map<Priority, PathRequest[]>;
  private service: PathfindingService;
  
  // Deduplication map: Key -> Promise
  private pendingRequests: Map<string, Promise<PathResult>> = new Map();
  
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

  /**
   * Запрашивает поиск пути.
   * Если путь есть в кэше, возвращает его мгновенно.
   * Если аналогичный запрос уже в очереди, возвращает существующий Promise (Deduplication).
   * Иначе ставит запрос в очередь.
   */
  public requestPath(
    start: Coordinates, 
    end: Coordinates, 
    priority: Priority = Priority.MEDIUM,
    options: PathOptions = {}
  ): Promise<PathResult> {
    
    // 1. Synchronous Cache Check (Bypass Queue & Deduplication)
    const cached = this.service.checkCache(start, end, options);
    if (cached) {
      return Promise.resolve(cached);
    }
    
    // 2. Generate Deduplication Key using Service logic (Grid Indices)
    // This ensures that two units close to each other mapped to the same tile share the request.
    const key = this.service.getPathKey(start, end, options);
    
    // 3. Check Pending Requests
    if (this.pendingRequests.has(key)) {
        return this.pendingRequests.get(key)!;
    }

    // 4. Enqueue Request
    const promise = new Promise<PathResult>((resolve, reject) => {
      // Queue Limit Check
      const totalSize = this.getTotalQueueSize();
      if (totalSize >= MAX_QUEUE_SIZE) {
          if (priority === Priority.LOW) {
              this.droppedCount++;
              reject(new Error("Queue full"));
              return;
          }
          // Drop BATCH of oldest LOW priority requests to make space
          // Dropping multiple items reduces frequent queue thrashing
          const lowQueue = this.queues.get(Priority.LOW)!;
          const dropCount = Math.min(10, lowQueue.length);
          
          if (dropCount > 0) {
              for (let i = 0; i < dropCount; i++) {
                const dropped = lowQueue.shift();
                if (dropped) {
                    dropped.reject(new Error("Dropped for higher priority"));
                    // We must delete from pendingRequests here because the Promise wrapper
                    // hasn't executed yet for these dropped items.
                    this.pendingRequests.delete(dropped.key);
                }
              }
          } else {
             // If no LOW items to drop, reject current MEDIUM/HIGH (unlikely but safe)
             reject(new Error("Queue full (Critical)"));
             return; 
          }
      }

      const request: PathRequest = {
        key,
        start,
        end,
        options,
        priority,
        resolve: (res) => {
            // Cleanup happens in the finally block of processQueue logic
            resolve(res);
        },
        reject: (err) => {
             // Cleanup happens in the finally block of processQueue logic
            reject(err);
        },
        timestamp: performance.now()
      };
      
      const queue = this.queues.get(priority);
      if (queue) {
        queue.push(request);
      } else {
        this.queues.get(Priority.MEDIUM)?.push(request);
      }
    });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  /**
   * Обрабатывает очередь в рамках выделенного бюджета времени.
   * @param budgetMs Максимальное время работы в миллисекундах (default: 2ms)
   */
  public processQueue(budgetMs: number = 2): void {
    const startTime = performance.now();
    let processed = 0;

    const priorities = [Priority.HIGH, Priority.MEDIUM, Priority.LOW];

    for (const priority of priorities) {
      const queue = this.queues.get(priority)!;

      while (queue.length > 0) {
        
        // BUDGET GUARD: Check BEFORE doing work
        if (performance.now() - startTime > budgetMs) {
           return; 
        }

        // Peek first, remove only if processed or aborted
        const request = queue[0];
        
        // --- Aging Check ---
        if (performance.now() - request.timestamp > MAX_WAIT_TIME) {
            queue.shift(); // Remove from queue
            request.reject(new Error("Request Timed Out (Aging)"));
            this.pendingRequests.delete(request.key);
            this.droppedCount++;
            continue;
        }

        // --- Cancellation Check ---
        if (request.options.signal?.aborted) {
            queue.shift(); // Remove
            request.reject(new Error("Aborted"));
            this.pendingRequests.delete(request.key);
            continue;
        }

        try {
            // Execute synchronous pathfinding
            const result = this.service.findPathSync(request.start, request.end, request.options);
            
            queue.shift(); // Remove after processing
            request.resolve(result);
            
            // Metrics
            const waitTime = performance.now() - request.timestamp;
            this.totalWaitTime += waitTime;
            this.processedWaitCount++;
            
            processed++;
        } catch (e) {
            queue.shift();
            request.reject(e);
        } finally {
            // ROBUST CLEANUP: Always ensure map is cleared
            if (this.pendingRequests.has(request.key)) {
                // If it was resolved/rejected above, the map entry might still exist 
                // if we didn't delete it inside resolve/reject wrappers.
                // To be safe, we delete it here, as this is the single point of completion.
                this.pendingRequests.delete(request.key);
            }
        }
      }
    }
    
    if (processed > 0) {
        this.processedCount += processed;
    }
  }

  private getTotalQueueSize(): number {
      return (this.queues.get(Priority.HIGH)?.length || 0) +
             (this.queues.get(Priority.MEDIUM)?.length || 0) +
             (this.queues.get(Priority.LOW)?.length || 0);
  }
}

export const pathfindingScheduler = new PathfindingScheduler(pathfindingService);