# 🏛 Roma Nova: Architectural Documentation (v2.7)

This document defines development standards for AI and the team. Any new code must adhere to these principles.

## 🚀 Technology Stack (2026)
- **Engine:** React Three Fiber (Three.js)
- **State:** Zustand (Actions + Selectors)
- **Logic:** Vanilla TypeScript (Headless Core)
- **Rendering:** InstancedMesh (GPU Optimized)
- **Tooling:** Vite + TailwindCSS

## 📂 Structure and Boundaries (Physical Boundaries)

### 1. `/src/entities` (Contracts)
- **Purpose:** Describe data schemes.
- **Rule:** Only `interface` and `type`. Logic and import dependencies are prohibited.

### 2. `/src/core` (Simulation)
- **Purpose:** The "brain" of the game. Mathematics, navigation, economics.
- **Rule:** **STRICTLY NO UI/3D.** Importing `Three.js` or `React` is prohibited.
- **Reference:** `src/core/utils/pathfinding.ts` (A* on Float32Array).

### 3. `/src/infrastructure` (Infrastructure)
- **Purpose:** Zustand store and external APIs.
- **Rule:** The only source of truth. The link between logic and view.

### 4. `/src/view` (View)
- **Purpose:** Visualization of the world.
- **Rule:** Read-only from the store. Calculation logic is prohibited. Use `InstancedMesh` for all mass objects.

## 🏗 Key Development Patterns

### Data Streams (Data Flow)
1.  **Input:** The user clicks -> An Action is called in Zustand.
2.  **Logic:** Action calls a service from `/src/core` (for example, `findPath`).
3.  **State:** The result is saved in the Store.
4.  **View:** R3F component sees changes and smoothly (lerp) moves the object.

### Navigation (Caesar 3 Style)
- **Weights:** Road (Road) = 0.5, Grass (Grass) = 1.0.
- **Sync:** Any map change (`placeBuilding`) must call `navigationService.updateTile()`.

### Performance
- A 50x50 map or larger is rendered only through instancing.
- Direct modification of `position` of Three.js objects bypassing the store is prohibited (except for visual interpolation).

## 🚫 Anti-patterns (Strictly Forbidden)
- Use of `any`.
- Magic numbers (all constants are in `/src/shared`).
- Duplication of the Zustand state into a local `useState`.
- Importing visual components into logic files.
