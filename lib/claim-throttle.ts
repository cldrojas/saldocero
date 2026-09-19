// lib/claim-throttle.ts
// In-memory, per-instance abuse control for the anonymous claim endpoint
// (R1-001 native-review fix). Best-effort by design: state lives in a single
// serverless instance and is NOT global across instances. No external deps.
export interface ClaimThrottleOptions {
  capacity: number // max tokens per refill window
  refillWindowMs: number // full refill window (tokens refill linearly to capacity)
  maxInFlightPerIp: number // max claims issued per IP within the in-flight window
  inFlightWindowMs: number // window used to count in-flight claims (use the claim TTL, 15 min)
}

export interface ThrottleDecision {
  allowed: boolean
  retryAfterMs?: number // present when !allowed
}

interface Bucket {
  tokens: number
  lastRefillAt: number
}

const MIN_RETRY_AFTER_MS = 1_000

export class ClaimThrottle {
  private readonly buckets = new Map<string, Bucket>()
  private readonly issues = new Map<string, number[]>()

  constructor(private readonly opts: ClaimThrottleOptions) {}

  /** Consume one token for the IP; refills linearly. Also enforces the in-flight cap. */
  tryConsume(ip: string, now: number): ThrottleDecision {
    const denied = (retryAfterMs: number): ThrottleDecision => ({
      allowed: false,
      retryAfterMs: Math.max(MIN_RETRY_AFTER_MS, Math.ceil(retryAfterMs)),
    })

    // ── Token bucket (linear refill, decay-on-read) ────────────────────────
    const bucket = this.buckets.get(ip) ?? { tokens: this.opts.capacity, lastRefillAt: now }
    const elapsedMs = now - bucket.lastRefillAt
    const refill = (elapsedMs / this.opts.refillWindowMs) * this.opts.capacity
    bucket.tokens = Math.min(this.opts.capacity, bucket.tokens + refill)
    bucket.lastRefillAt = now
    this.buckets.set(ip, bucket)

    if (bucket.tokens < 1) {
      const msPerToken = this.opts.refillWindowMs / this.opts.capacity
      return denied((1 - bucket.tokens) * msPerToken)
    }
    bucket.tokens -= 1

    // ── In-flight cap (entries expire at age >= inFlightWindowMs) ──────────
    const windowStart = now - this.opts.inFlightWindowMs
    const ipIssues = (this.issues.get(ip) ?? []).filter((at) => at > windowStart)
    if (ipIssues.length >= this.opts.maxInFlightPerIp) {
      return denied(ipIssues[0] + this.opts.inFlightWindowMs - now)
    }
    if (ipIssues.length === 0) this.issues.delete(ip)

    return { allowed: true }
  }

  /** Record a successful claim issue for the IP (in-flight accounting). Prunes expired entries. */
  recordIssue(ip: string, now: number): void {
    const windowStart = now - this.opts.inFlightWindowMs
    const ipIssues = [...(this.issues.get(ip) ?? []).filter((at) => at > windowStart), now]
    this.issues.set(ip, ipIssues)
  }

  /** Test seam: reset internal maps. */
  reset(): void {
    this.buckets.clear()
    this.issues.clear()
  }
}