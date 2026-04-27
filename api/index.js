export const config = { runtime: "edge" };

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive",
  "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
  "forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
]);

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvPipeline(cmds) {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmds),
    });
  } catch (_) {}
}

async function trackRequest(status, bytes) {
  const today = new Date().toISOString().slice(0, 10);
  const group = status >= 500 ? "5xx" : status >= 400 ? "4xx" : status >= 300 ? "3xx" : "2xx";
  await kvPipeline([
    ["INCR", "relay:totalRequests"],
    ["INCR", `relay:day:${today}`],
    ["EXPIRE", `relay:day:${today}`, 60 * 60 * 24 * 8],
    ["INCRBY", "relay:totalBytes", bytes || 0],
    ["INCR", `relay:status:${group}`],
    ["SET", "relay:lastRequestAt", Date.now()],
  ]);
}

export default async function handler(req) {
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  try {
    const pathStart = req.url.indexOf("/", 8);
    const targetUrl =
      pathStart === -1 ? TARGET_BASE + "/" : TARGET_BASE + req.url.slice(pathStart);

    const out = new Headers();
    let clientIp = null;
    for (const [k, v] of req.headers) {
      if (STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;
      if (k === "x-real-ip")       { clientIp = v; continue; }
      if (k === "x-forwarded-for") { if (!clientIp) clientIp = v; continue; }
      out.set(k, v);
    }
    if (clientIp) out.set("x-forwarded-for", clientIp);

    const method  = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    const response = await fetch(targetUrl, {
      method,
      headers: out,
      body: hasBody ? req.body : undefined,
      duplex: "half",
      redirect: "manual",
    });

    const bytes = parseInt(response.headers.get("content-length") || "0", 10);
    // fire-and-forget — doesn't block the response
    req.signal?.addEventListener("abort", () => {});
    Promise.resolve().then(() => trackRequest(response.status, bytes));

    return response;
  } catch (err) {
    console.error("relay error:", err);
    Promise.resolve().then(() => trackRequest(502, 0));
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}
