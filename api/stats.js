export const config = { runtime: "edge" };

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const json = await res.json();
  return json.result;
}

async function kvMget(keys) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(keys.map(k => ["GET", k])),
  });
  const arr = await res.json();
  return arr.map(r => r.result);
}

export default async function handler(req) {
  // Allow dashboard page to call this
  const origin = req.headers.get("origin") || "";
  const cors = {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET",
    "Content-Type": "application/json",
  };

  if (!KV_URL || !KV_TOKEN) {
    return new Response(JSON.stringify({ error: "KV not configured" }), { status: 500, headers: cors });
  }

  try {
    // Build last-7-days keys
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      days.push(d.toISOString().slice(0, 10));
    }
    const today = days[days.length - 1];

    const [
      totalRequests, totalBytes, lastRequestAt,
      s2xx, s3xx, s4xx, s5xx,
      ...dailyCounts
    ] = await kvMget([
      "relay:totalRequests", "relay:totalBytes", "relay:lastRequestAt",
      "relay:status:2xx", "relay:status:3xx", "relay:status:4xx", "relay:status:5xx",
      ...days.map(d => `relay:day:${d}`),
    ]);

    const data = {
      totalRequests:  parseInt(totalRequests  || 0),
      totalBytes:     parseInt(totalBytes     || 0),
      lastRequestAt:  parseInt(lastRequestAt  || 0),
      todayRequests:  parseInt(dailyCounts[dailyCounts.length - 1] || 0),
      statusGroups: {
        "2xx": parseInt(s2xx || 0),
        "3xx": parseInt(s3xx || 0),
        "4xx": parseInt(s4xx || 0),
        "5xx": parseInt(s5xx || 0),
      },
      errors5xx: parseInt(s5xx || 0),
      daily: days.map((date, i) => ({ date, count: parseInt(dailyCounts[i] || 0) })),
    };

    return new Response(JSON.stringify(data), { headers: cors });
  } catch (err) {
    console.error("stats error:", err);
    return new Response(JSON.stringify({ error: "Failed to fetch stats" }), { status: 500, headers: cors });
  }
}
