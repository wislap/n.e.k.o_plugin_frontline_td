// Shared Vite SSR module loader: runs src public barrels under Node with
// extensionless TS imports and import.meta.env resolved (eval runner and
// tooling generators both need it — ADR 0024).
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export type SsrLoad = (id: string) => Promise<unknown>;

export async function withViteSsr<T>(fn: (load: SsrLoad) => Promise<T>): Promise<T> {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'error',
  });
  try {
    return await fn((id) => server.ssrLoadModule(id));
  } finally {
    await server.close();
  }
}
