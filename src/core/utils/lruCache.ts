/**
 * @module Core/Utils/LRUCache
 * @layer Core
 * @description Generic Least Recently Used (LRU) Cache implementation.
 * Uses a Map for O(1) lookup and a Doubly Linked List for O(1) order management.
 * 
 * PERFORMANCE:
 * - get: O(1)
 * - put: O(1)
 * - delete: O(1)
 */

interface DllNode<K, V> {
  key: K;
  value: V;
  prev: DllNode<K, V> | null;
  next: DllNode<K, V> | null;
}

export class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, DllNode<K, V>>;
  private head: DllNode<K, V> | null = null; // MRU (Most Recently Used)
  private tail: DllNode<K, V> | null = null; // LRU (Least Recently Used)

  /**
   * @param capacity Maximum number of items the cache can hold before evicting.
   */
  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  /**
   * Retrieves a value from the cache.
   * Updates the item's position to the head (MRU).
   * @returns The value or undefined if not found.
   */
  public get(key: K): V | undefined {
    const node = this.cache.get(key);
    if (!node) {
      return undefined;
    }

    this.moveToHead(node);
    return node.value;
  }

  /**
   * Inserts or updates a value in the cache.
   * If updating, moves to head.
   * If inserting new and capacity is reached, evicts the tail (LRU).
   */
  public put(key: K, value: V): void {
    const existingNode = this.cache.get(key);

    if (existingNode) {
      existingNode.value = value;
      this.moveToHead(existingNode);
    } else {
      const newNode: DllNode<K, V> = {
        key,
        value,
        prev: null,
        next: null
      };

      this.cache.set(key, newNode);
      this.addToHead(newNode);

      if (this.cache.size > this.capacity) {
        this.removeTail();
      }
    }
  }

  /**
   * Removes an item from the cache.
   */
  public delete(key: K): void {
    const node = this.cache.get(key);
    if (node) {
      this.removeNode(node);
      this.cache.delete(key);
    }
  }

  /**
   * Clears the cache completely.
   */
  public clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  /**
   * Returns the current number of items.
   */
  public size(): number {
    return this.cache.size;
  }

  // --- Linked List Helpers ---

  private moveToHead(node: DllNode<K, V>): void {
    if (node === this.head) {
      return; 
    }
    
    this.removeNode(node);
    this.addToHead(node);
  }

  private removeNode(node: DllNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
    
    // Cleanup references to avoid memory leaks
    node.prev = null;
    node.next = null;
  }

  private addToHead(node: DllNode<K, V>): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeTail(): void {
    if (!this.tail) return;

    const keyToRemove = this.tail.key;
    this.removeNode(this.tail);
    this.cache.delete(keyToRemove);
  }
}