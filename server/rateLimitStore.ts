import type { Options } from 'express-rate-limit';

// A timer-free memory store so rate limiting works inside the Workers runtime
// as well as Node: workerd forbids setInterval/setTimeout in the global scope,
// where express-rate-limit's default MemoryStore initialises its sweep timer.
// Expired windows are rolled lazily on request instead.
type Client = { totalHits: number; resetTime: Date };

export class TimerFreeMemoryStore {
  // Tells express-rate-limit's single-count validation to key counters by this
  // store instance rather than the class name — otherwise every limiter using
  // this class shares one validation bucket and trips false double-counts.
  readonly localKeys = true;
  private previous = new Map<string, Client>();
  private current = new Map<string, Client>();
  private windowMs = 60_000;
  private lastSweep = 0;

  init(options: Pick<Options, 'windowMs'>) {
    this.windowMs = options.windowMs;
  }

  private sweep(now: number) {
    // Roll windows lazily — at most once per window — instead of on a timer.
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    this.previous = this.current;
    this.current = new Map();
  }

  async get(key: string): Promise<Client | undefined> {
    this.sweep(Date.now());
    return this.current.get(key) ?? this.previous.get(key);
  }

  async increment(key: string): Promise<Client> {
    const now = Date.now();
    this.sweep(now);
    const client = this.getClient(key);
    if (client.resetTime.getTime() <= now) this.resetClient(client, now);
    client.totalHits++;
    return client;
  }

  async decrement(key: string): Promise<void> {
    const client = this.getClient(key);
    if (client.totalHits > 0) client.totalHits--;
  }

  async resetKey(key: string): Promise<void> {
    this.current.delete(key);
    this.previous.delete(key);
  }

  async resetAll(): Promise<void> {
    this.current.clear();
    this.previous.clear();
  }

  shutdown(): void {
    void this.resetAll();
  }

  private resetClient(client: Client, now = Date.now()): Client {
    client.totalHits = 0;
    client.resetTime.setTime(now + this.windowMs);
    return client;
  }

  private getClient(key: string): Client {
    if (this.current.has(key)) return this.current.get(key)!;
    let client: Client;
    if (this.previous.has(key)) {
      client = this.previous.get(key)!;
      this.previous.delete(key);
    } else {
      client = { totalHits: 0, resetTime: new Date() };
      this.resetClient(client);
    }
    this.current.set(key, client);
    return client;
  }
}
