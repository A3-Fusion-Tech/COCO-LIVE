/**
 * A Map that records which keys a request may have touched. Entities are mutated in place by the
 * application services, so any read that hands out an object (get/values/entries/iteration) is
 * treated as a potential write; the persistence layer then compares the serialized value with what
 * is stored and only writes real changes.
 */
export class TrackedMap<V> extends Map<string, V> {
  readonly name: string;
  touched = new Set<string>();
  removed = new Set<string>();
  private all = false;

  constructor(name: string) {
    super();
    this.name = name;
  }

  override get(key: string): V | undefined {
    if (super.has(key)) this.touched.add(key);
    return super.get(key);
  }
  override set(key: string, value: V): this {
    this.touched.add(key);
    this.removed.delete(key);
    return super.set(key, value);
  }
  override delete(key: string): boolean {
    this.touched.add(key);
    this.removed.add(key);
    return super.delete(key);
  }
  override clear(): void {
    for (const k of super.keys()) this.removed.add(k);
    super.clear();
  }
  override values(): MapIterator<V> { this.all = true; return super.values(); }
  override entries(): MapIterator<[string, V]> { this.all = true; return super.entries(); }
  override forEach(cb: (v: V, k: string, m: Map<string, V>) => void, thisArg?: unknown): void { this.all = true; super.forEach(cb, thisArg); }
  override [Symbol.iterator](): MapIterator<[string, V]> { this.all = true; return super[Symbol.iterator](); }

  /** Keys that must be checked at flush time. */
  candidates(): string[] {
    return this.all ? [...new Set([...super.keys(), ...this.removed])] : [...this.touched];
  }
  /** Reset tracking (after a flush, rollback or hydration). */
  resetTracking() {
    this.touched.clear();
    this.removed.clear();
    this.all = false;
  }
  /** Load without marking anything as touched. */
  hydrate(key: string, value: V) { super.set(key, value); }
}
