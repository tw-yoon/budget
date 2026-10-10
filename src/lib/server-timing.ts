import { gzipSync } from "node:zlib";

// Adds `Server-Timing: app;dur=<ms>` to a route's answer: how long the server
// itself took, so the iPhone app can tell server time from network time
// (Settings → Load times). Only the routes the phone's screens open with use it.
//
// It also gzips the answer. Next compresses pages but not route handlers, and
// the phone reads only route handlers: a ledger page is ~35 KB raw, ~5 KB
// gzipped, which matters over Tailscale on cellular. URLSession unpacks it.
export function withServerTiming<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const start = performance.now();
    const res = await gzipped(args[0], await handler(...args));
    res.headers.set("Server-Timing", serverTiming(performance.now() - start));
    return res;
  };
}

export function serverTiming(ms: number): string {
  return `app;dur=${ms.toFixed(1)}`;
}

// Below this, gzip's header and the CPU cost outweigh the bytes saved.
const MIN_BYTES = 1024;

// Next passes the request as a route handler's first argument even when the
// handler declares none, so the wrapper can read Accept-Encoding.
async function gzipped(req: unknown, res: Response): Promise<Response> {
  const accepts =
    req instanceof Request && /\bgzip\b/.test(req.headers.get("Accept-Encoding") ?? "");
  const json = res.headers.get("Content-Type")?.startsWith("application/json") ?? false;
  if (!accepts || !json || !res.body || res.headers.has("Content-Encoding")) return res;

  const body = Buffer.from(await res.arrayBuffer());
  const headers = new Headers(res.headers);
  const init = { status: res.status, statusText: res.statusText, headers };
  if (body.length < MIN_BYTES) return new Response(body, init);
  headers.set("Content-Encoding", "gzip");
  headers.append("Vary", "Accept-Encoding");
  headers.delete("Content-Length");
  return new Response(gzipSync(body), init);
}
