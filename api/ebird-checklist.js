/**
 * Vercel Serverless Function — /api/ebird-checklist
 *
 * Proxies requests for a single checklist's full detail.
 *
 * Query params:
 *   checklistId — eBird checklist submission ID (e.g. S12345678)
 */
export const config = { runtime: "nodejs20.x" };

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { checklistId } = req.query;

  if (!checklistId) {
    return res.status(400).json({ error: "Missing required param: checklistId" });
  }

  const apiKey = process.env.EBIRD_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "EBIRD_API_KEY not configured — check Vercel environment variables" });
  }

  try {
    const url = `https://api.ebird.org/v2/product/checklist/view/${checklistId}`;
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