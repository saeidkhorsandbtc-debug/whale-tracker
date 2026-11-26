export class SignatureLruCache {
  private readonly maxSize: number;
  private readonly cache: Map<string, number>;

  constructor(maxSize = 10_000) {
    this.maxSize = maxSize;
    this.cache = new Map<string, number>();
  }

  has(signature: string): boolean {
    if (!this.cache.has(signature)) {
      return false;
    }
    // Refresh recency order
    const ts = this.cache.get(signature)!;
    this.cache.delete(signature);
    this.cache.set(signature, ts);
    return true;
  }

  add(signature: string): void {
    if (this.cache.has(signature)) {
      this.cache.delete(signature);
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(signature, Date.now());
  }

  size(): number {
    return this.cache.size;
  }
}
