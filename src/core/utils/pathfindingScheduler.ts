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
  start: Coordinates;
  end: Coordinates;
  options: PathOptions;
  priority: Priority;
  resolve: (value: PathResult) => void;
  reject: (reason?: any) => void;
  timestamp: number;
}

class PathfindingScheduler {
  private queues: Map<Priority, PathRequest[]>;
  private service: PathfindingService;
  
  // Debug metrics
  private processedCount = 0;

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
   * Иначе ставит запрос в очередь.
   */
  public requestPath(
    start: Coordinates, 
    end: Coordinates, 
    priority: Priority = Priority.MEDIUM,
    options: PathOptions = {}
  ): Promise<PathResult> {
    
    // 1. Synchronous Cache Check (Bypass Queue)
    // Try LRU Cache
    const cached = this.service.checkCache(start, end, options);
    if (cached) {
      return Promise.resolve(cached);
    }
    
    // 2. Enqueue Request
    return new Promise((resolve, reject) => {
      const request: PathRequest = {
        start,
        end,
        options,
        priority,
        resolve,
        reject,
        timestamp: performance.now()
      };
      
      const queue = this.queues.get(priority);
      if (queue) {
        queue.push(request);
      } else {
        // Fallback
        this.queues.get(Priority.MEDIUM)?.push(request);
      }
    });
  }

  /**
   * Обрабатывает очередь в рамках выделенного бюджета времени.
   * Должен вызываться в игровом цикле (например, useFrame).
   * @param budgetMs Максимальное время работы в миллисекундах (default: 2ms)
   */
  public processQueue(budgetMs: number = 2): void {
    const startTime = performance.now();
    let processed = 0;

    // Process queues in order of priority
    const priorities = [Priority.HIGH, Priority.MEDIUM, Priority.LOW];

    for (const priority of priorities) {
      const queue = this.queues.get(priority)!;

      while (queue.length > 0) {
        // Check budget
        if (performance.now() - startTime > budgetMs) {
           return; 
        }

        // Dequeue (FIFO)
        const request = queue.shift();
        if (!request) break;

        // Execute A*
        // We catch errors to prevent the scheduler from crashing
        try {
            this.service.findPath(request.start, request.end, request.options)
                .then(result => request.resolve(result))
                .catch(err => request.reject(err));
            
            processed++;
        } catch (e) {
            request.reject(e);
        }
      }
    }
    
    if (processed > 0) {
        this.processedCount += processed;
    }
  }
}

export const pathfindingScheduler = new PathfindingScheduler(pathfindingService);