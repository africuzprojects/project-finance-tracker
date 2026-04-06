/**
 * Live FX — units of each code per 1 USD (same convention as Settings).
 *
 * 1) Primary: open.er-api.com (ExchangeRate-API public feed — broad coverage, close to typical “Google” spot).
 * 2) Fallback: Frankfurter (ECB reference rates, daily).
 * 3) Last resort: exchangerate.host
 *
 * No API keys. Requires network + CORS (works in browser and on same-origin deploys).
 */
(function (global) {
  const ER_API = "https://open.er-api.com/v6/latest/USD";
  const FRANKFURTER = "https://api.frankfurter.app/latest?from=USD&to=";

  async function fetchRatesForCodes(codes) {
    const need = (codes || []).filter((c) => c && c !== "USD");
    if (!need.length) return { USD: 1 };
    const rates = { USD: 1 };

    try {
      const r = await fetch(ER_API);
      if (r.ok) {
        const j = await r.json();
        if (j.result === "success" && j.rates && typeof j.rates === "object") {
          need.forEach((c) => {
            if (typeof j.rates[c] === "number" && j.rates[c] > 0) rates[c] = j.rates[c];
          });
        }
      }
    } catch (_e) {
      /* fall through */
    }

    let missing = need.filter((c) => rates[c] == null);
    if (missing.length) {
      try {
        const r = await fetch(FRANKFURTER + missing.join(","));
        if (r.ok) {
          const j = await r.json();
          if (j.rates && typeof j.rates === "object") {
            missing.forEach((c) => {
              if (typeof j.rates[c] === "number" && j.rates[c] > 0) rates[c] = j.rates[c];
            });
          }
        }
      } catch (_e) {
        /* fall through */
      }
    }

    missing = need.filter((c) => rates[c] == null);
    if (missing.length) {
      const r2 = await fetch("https://api.exchangerate.host/latest?base=USD");
      if (!r2.ok) throw new Error("FX: all sources failed");
      const j2 = await r2.json();
      if (!j2.success || !j2.rates) throw new Error("Invalid FX response");
      missing.forEach((c) => {
        if (typeof j2.rates[c] === "number" && j2.rates[c] > 0) rates[c] = j2.rates[c];
      });
    }

    return rates;
  }

  global.PFTFx = { fetchRatesForCodes };
})(typeof window !== "undefined" ? window : globalThis);
