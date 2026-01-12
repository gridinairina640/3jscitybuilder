/**
 * @module Core/Systems/WalkerSystem
 * @layer Core
 * @description Система управления перемещением рабочих (Walkers).
 * Реализует гибридную логику: Random Walk (по дорогам) и Patrol (по маршруту).
 * Работает только с данными, не зависит от View.
 */

import { GameEntity, Coordinates } from '../../shared/types';
import { BuildingType } from '../../entities/Buildings';
import { PathfindingService } from '../utils/pathfinding';

const HISTORY_SIZE = 5; // Количество запоминаемых последних клеток для предотвращения циклов

/**
 * Проверяет, является ли тайл дорогой.
 * В текущей архитектуре дороги — это сущности (Buildings) с типом ROAD.
 */
const isRoadTile = (x: number, z: number, entities: GameEntity[]): boolean => {
  return entities.some(e => 
    e.type === BuildingType.ROAD && 
    Math.round(e.position.x) === x && 
    Math.round(e.position.z) === z
  );
};

/**
 * Основная функция принятия решений для юнита-рабочего.
 * Вызывается, когда юнит стоит на месте (IDLE) или завершил шаг.
 */
export const processWalkerDecision = async (
  walker: GameEntity,
  parentBuilding: GameEntity | undefined,
  allEntities: GameEntity[],
  pathfinding: PathfindingService
): Promise<Partial<GameEntity> | null> => {
  
  // 1. Блокирующие проверки
  if (walker.isCalculatingPath) return null; // Ждем завершения A*
  if (walker.path && walker.path.length > 0) return null; // Юнит еще идет по пути

  // 2. Логика возврата домой
  if (walker.state === 'RETURNING') {
    // Если мы здесь, значит путь пуст (path.length === 0), то есть юнит пришел домой.
    // Логика "исчезновения" или сброса ресурсов должна быть обработана вне этой системы.
    // Мы просто сбрасываем состояние.
    return {
      state: 'IDLE',
      currentRange: walker.maxRange || 100, // Сброс рейнджа
      visitedTiles: []
    };
  }

  // 3. Проверка лимита хода (Range Check)
  // Если рейндж кончился, инициируем возврат домой через A*
  const currentRange = walker.currentRange ?? 0;
  if (currentRange <= 0 && parentBuilding) {
    // Инициируем поиск пути домой
    try {
      // Возвращаем флаг isCalculatingPath, чтобы заблокировать юнита до получения пути.
      // Реальный путь будет установлен Store через promise, но здесь мы возвращаем намерение.
      // В данной синхронной реализации мы вызываем async сервис и сразу возвращаем promise-based update?
      // Архитектурно: Система возвращает объект для патча. Если A* асинхронный, мы ставим флаг.
      
      const update: Partial<GameEntity> = { isCalculatingPath: true };
      
      pathfinding.findPath(walker.position, parentBuilding.position, { failToClosest: true })
        .then(result => {
           // Внимание: этот колбек должен быть обработан уровнем выше (в Store), 
           // либо мы предполагаем, что данная функция вызывается внутри async action.
           // Но так как сигнатура функции возвращает Promise<Partial>, мы можем подождать.
        });

      // Ждем путь
      const pathResult = await pathfinding.findPath(walker.position, parentBuilding.position, { failToClosest: true });
      
      return {
        state: 'RETURNING',
        path: pathResult.path,
        isCalculatingPath: false
      };

    } catch (e) {
      console.error("Walker cannot find path home", e);
      return { state: 'IDLE' }; // Застрял
    }
  }

  // 4. Логика Патрулирования (Patrol Path)
  // Если у родительского здания есть заданный маршрут
  if (parentBuilding?.patrolPath && parentBuilding.patrolPath.length > 0) {
    const currentIndex = walker.patrolIndex ?? 0;
    const targetPoint = parentBuilding.patrolPath[currentIndex];
    
    // Если мы уже в целевой точке, переключаемся на следующую
    if (Math.round(walker.position.x) === targetPoint.x && Math.round(walker.position.z) === targetPoint.z) {
        const nextIndex = (currentIndex + 1) % parentBuilding.patrolPath.length;
        return { patrolIndex: nextIndex }; // На следующем тике пойдем к новой точке
    }

    // Идем к текущей цели через A*
    const pathResult = await pathfinding.findPath(walker.position, targetPoint, { failToClosest: true });
    
    return {
      state: 'MOVING',
      path: pathResult.path,
      currentRange: currentRange - (pathResult.path.length * 1) // Примерное списание рейнджа
    };
  }

  // 5. Логика Случайного Блуждания (Random Walk)
  // Работает только если нет патрульного пути.
  
  const pos = walker.position;
  const candidates: Coordinates[] = [
    { x: pos.x + 1, z: pos.z },
    { x: pos.x - 1, z: pos.z },
    { x: pos.x, z: pos.z + 1 },
    { x: pos.x, z: pos.z - 1 }
  ];

  // Фильтр 1: Только дороги
  let validMoves = candidates.filter(c => isRoadTile(c.x, c.z, allEntities));

  // Фильтр 2: Избегание недавно посещенных (Heuristic)
  const history = walker.visitedTiles || [];
  const unvisitedMoves = validMoves.filter(m => 
    !history.some(h => h.x === m.x && h.z === m.z)
  );

  // Стратегия выбора
  let nextTile: Coordinates | null = null;

  if (unvisitedMoves.length > 0) {
    // Приоритет: случайная непосещенная дорога
    nextTile = unvisitedMoves[Math.floor(Math.random() * unvisitedMoves.length)];
  } else if (validMoves.length > 0) {
    // Тупик: возвращаемся назад (допускаем посещенную клетку)
    nextTile = validMoves[Math.floor(Math.random() * validMoves.length)];
  } else {
    // Нет дорог рядом: стоим (или можно добавить логику блуждания по траве)
    return { state: 'IDLE' }; 
  }

  // Формируем результат шага
  // Для Random Walk путь состоит из 1 точки (соседняя клетка)
  const newHistory = [pos, ...history].slice(0, HISTORY_SIZE);

  return {
    state: 'MOVING',
    path: [nextTile], // Путь длиной в 1 шаг
    currentRange: currentRange - 1,
    visitedTiles: newHistory
  };
};