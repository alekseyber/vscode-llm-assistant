// Сетевые заглушки для e2e: живые сокеты на loopback, без внешних сервисов.

import * as http from 'http';
import * as net from 'net';

export interface StubServer {
  url: string;
  hits: Record<string, number>;
  bodies: any[];
  close: () => Promise<void>;
}

export type StubHandler = (req: http.IncomingMessage, res: http.ServerResponse, body: any) => void;

/** HTTP-сервер на эфемерном порту: отдаёт то, что велит обработчик, и журналирует запросы. */
export async function startStub(handler: StubHandler, port = 0): Promise<StubServer> {
  const hits: Record<string, number> = {};
  const bodies: any[] = [];
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    hits[path] = (hits[path] ?? 0) + 1;
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let body: any = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { raw };
      }
      bodies.push(body);
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  const boundPort = (server.address() as any).port;
  return {
    url: `http://127.0.0.1:${boundPort}`,
    hits,
    bodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** «Чёрная дыра»: принимает TCP-соединение, читает и молчит — порт открыт, ответа нет. */
export async function startBlackhole(): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('data', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Порт, на котором гарантированно никто не слушает (отказ соединения). */
export async function closedPortUrl(): Promise<string> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

/** NDJSON-ответ на /api/chat: массив чанков, каждый — отдельной строкой. */
export function ndjson(res: http.ServerResponse, chunks: any[]): void {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  for (const chunk of chunks) res.write(`${JSON.stringify(chunk)}\n`);
  res.end();
}

/** JSON-ответ. */
export function json(res: http.ServerResponse, body: any, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
