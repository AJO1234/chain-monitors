// A shared, process-wide rate limiter per upstream host.
//
// ⚠️ WHY: GeckoTerminal's free tier rate-limits around 30 calls/min, and this
// process has THREE independent callers — the new-pair collector (every 60s,
// plus a classify call per discovery and re-measurements), the dashboard's
// token enrichment, and the live tape. Each was polite on its own and the sum
// was not: observed live as `{"status":{"error_code":429,...}}`, which surfaced
// as tokens with no name, no market cap and no liquidity. A 429 does not look
// like an error in the UI — it looks like a token nobody has heard of.
//
// So the limit is enforced in ONE place that every caller shares, rather than
// asking each caller to be well-behaved separately.

const buckets = new Map();

function bucket(host, minIntervalMs) {
  let b = buckets.get(host);
  if (!b) {
    b = { minIntervalMs, last: 0, chain: Promise.resolve(), penaltyUntil: 0, throttled: 0, waited: 0 };
    buckets.set(host, b);
  }
  return b;
}

/**
 * Run `fn` no sooner than `minIntervalMs` after the previous call to the same
 * host. Calls queue in order rather than being dropped.
 */
function schedule(host, minIntervalMs, fn) {
  const b = bucket(host, minIntervalMs);
  const run = async () => {
    const now = Date.now();
    const earliest = Math.max(b.last + b.minIntervalMs, b.penaltyUntil);
    const wait = earliest - now;
    if (wait > 0) { b.waited += wait; await new Promise((r) => setTimeout(r, wait)); }
    b.last = Date.now();
    return fn();
  };
  // Serialise through a promise chain so concurrency cannot defeat the spacing.
  const result = b.chain.then(run, run);
  b.chain = result.then(() => {}, () => {});
  return result;
}

/**
 * Called when an upstream says 429. Backs the whole host off, so every queued
 * caller waits instead of each discovering the limit independently.
 */
function penalise(host, ms = 60000) {
  const b = buckets.get(host);
  if (!b) return;
  b.penaltyUntil = Math.max(b.penaltyUntil, Date.now() + ms);
  b.throttled++;
  console.warn(`[ratelimit] ${host} returned 429 — backing off ${Math.round(ms / 1000)}s`);
}

function stats() {
  const out = {};
  for (const [host, b] of buckets) {
    out[host] = {
      minIntervalMs: b.minIntervalMs,
      throttled429: b.throttled,
      backingOffFor: Math.max(0, b.penaltyUntil - Date.now()),
      totalWaitMs: Math.round(b.waited),
    };
  }
  return out;
}

module.exports = { schedule, penalise, stats };
