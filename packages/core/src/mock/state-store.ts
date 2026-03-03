/**
 * In-memory store for stateful API mocking.
 *
 * When an agent creates a Stripe PaymentIntent, the mock returns an ID.
 * When the agent later retrieves that PaymentIntent, the mock returns
 * the same object.
 */
export class StateStore {
  private state = new Map<string, Map<string, unknown>>();

  /** Store a resource: set('stripe', 'pi_abc123', { amount: 5000, status: 'created' }) */
  set(namespace: string, key: string, value: unknown): void {
    if (!this.state.has(namespace)) this.state.set(namespace, new Map());
    this.state.get(namespace)!.set(key, value);
  }

  /** Retrieve a resource */
  get<T = unknown>(namespace: string, key: string): T | undefined {
    return this.state.get(namespace)?.get(key) as T | undefined;
  }

  /** List all resources in a namespace */
  list<T = unknown>(namespace: string): T[] {
    return [...(this.state.get(namespace)?.values() || [])] as T[];
  }

  /** Update a resource (shallow merge) */
  update(namespace: string, key: string, patch: Record<string, unknown>): void {
    const existing = this.get<Record<string, unknown>>(namespace, key);
    if (existing) {
      this.set(namespace, key, { ...existing, ...patch });
    }
  }

  /** Filter resources in a namespace by predicate */
  filter<T = unknown>(namespace: string, predicate: (item: T, key: string) => boolean): T[] {
    const ns = this.state.get(namespace);
    if (!ns) return [];
    const result: T[] = [];
    for (const [key, value] of ns) {
      if (predicate(value as T, key)) result.push(value as T);
    }
    return result;
  }

  /** Delete a resource */
  delete(namespace: string, key: string): boolean {
    return this.state.get(namespace)?.delete(key) ?? false;
  }

  /** Clear all state */
  clear(): void {
    this.state.clear();
  }
}
