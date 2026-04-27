export const config = { runtime: "edge" };

// TARGET_DOMAIN can be a single URL or a comma-separated list of URLs.
// e.g. "https://a.example.com,https://b.example.com,https://1.2.3.4:8080"
const RAW_TARGETS = (process.env.TARGET_DOMAIN || "")
  .split(",")
  .map((t) => t.trim().replace(/\/$/, ""))
  .filter(Boolean);

const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

function pickTarget() {
  if (RAW_TARGETS.length === 0) return null;
  // Random selection across all targets for simple load balancing
  return RAW_TARGETS[Math.floor(Math.random() * RAW_TARGETS.length)];
}

export default async function handler(req) {
  if (RAW_TARGETS.length === 0) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  try {
    const TARGET_BASE = pickTarget();

    const pathStart = req.url.indexOf("/", 8);
    const targetUrl =
      pathStart === -1 ? TARGET_BASE + "/" : TARGET_BASE + req.url.slice(pathStart);

    const out = new Headers();
    let clientIp = null;
    for (const [k, v] of req.headers) {
      if (STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;
      if (k === "x-real-ip") {
        clientIp = v;
        continue;
      }
      if (k === "x-forwarded-for") {
        if (!clientIp) clientIp = v;
        continue;
      }
      out.set(k, v);
    }
    if (clientIp) out.set("x-forwarded-for", clientIp);

    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    return await fetch(targetUrl, {
      method,
      headers: out,
      body: hasBody ? req.body : undefined,
      duplex: "half",
      redirect: "manual",
    });
  } catch (err) {
    console.error("relay error:", err);
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}
