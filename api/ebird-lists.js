/**
 * Vercel Serverless Function — /api/ebird-lists
 *
 * Proxies requests to the eBird personal checklist endpoint,
 * bypassing browser CORS restrictions.
 *
 * Query params:
 *   subId    — eBird user ID (e.g. NDE2OTMxOA)
 *   offset   — pagination offset (default 0)
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { subId, offset = 0 } = req.query;

  if (!subId) {
    return res.status(400).json({ error: "Missing required param: subId" });
  }

  const apiKey = process.env.EBIRD_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "EBIRD_API_KEY not configured — check Vercel environment variables" });
  }

  try {
    const url = `https://api.ebird.org/v2/product/lists/${subId}?maxResults=200&offset=${offset}`;
    const upstream = await fetch(url, {
      headers: {
        "X-eBirdApiToken": apiKey,
        "Accept": "application/json",
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error(`eBird API error ${upstream.status}:`, text);
      return res.status(upstream.status).json({
        error: `eBird returned ${upstream.status}`,
        detail: text,
      });
    }

    const body = await upstream.json();
    return res.status(200).json(body);
  } catch (err) {
    console.error("Proxy fetch failed:", err);
    return res.status(502).json({ error: "Failed to reach eBird API", detail: err.message });
  }
}