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
          // Drop oldest LOW priority request to make space
          const lowQueue = this.queues.get(Priority.LOW)!;
          if (lowQueue.length > 0) {
              const dropped = lowQueue.shift();
              dropped?.reject(new Error("Dropped for higher priority"));
              this.pendingRequests.delete(dropped!.key);
          }
      }

      const request: PathRequest = {
        key,
        start,
        end,
        options,
        priority,
        resolve: (res) => {
            this.pendingRequests.delete(key);
            resolve(res);
        },
        reject: (err) => {
            this.pendingRequests.delete(key);
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
        // Peek first, remove only if processed or aborted
        const request = queue[0];

        // Check cancellation
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
        }

        // Check Budget
        if (performance.now() - startTime > budgetMs) {
           return; 
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