declare module 'ws' {
  export class WebSocket {
    static readonly OPEN: number;
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
  }
  export class WebSocketServer {
    constructor(options?: { noServer?: boolean; server?: unknown });
    handleUpgrade(
      request: unknown,
      socket: unknown,
      head: Buffer,
      callback: (ws: WebSocket) => void,
    ): void;
  }
}