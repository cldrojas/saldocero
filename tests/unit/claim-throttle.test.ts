// tests/unit/claim-throttle.test.ts
// Deterministic unit tests for the in-memory per-IP claim throttle (R1-001
// native-review fix). No timers: `now` is passed explicitly.
import { describe, it, expect } from 'vitest'
import { ClaimThrottle } from '@/lib/claim-throttle'

const REFILL_WINDOW_MS = 60_000
const CAPACITY = 10
const IN_FLIGHT_WINDOW_MS = 15 * 60_000 // claim TTL
const MAX_IN_FLIGHT = 3

function makeThrottle(): ClaimThrottle {
  return new ClaimThrottle({
    capacity: CAPACITY,
    refillWindowMs: REFILL_WINDOW_MS,
    maxInFlightPerIp: MAX_IN_FLIGHT,
    inFlightWindowMs: IN_FLIGHT_WINDOW_MS,
  })
}

describe('ClaimThrottle', () => {
  it('allows a fresh IP up to capacity times, then denies with retryAfterMs', () => {
    const throttle = makeThrottle()
    const now = 1_000_000
    for (let i = 0; i < CAPACITY; i++) {
      expect(throttle.tryConsume('1.2.3.4', now).allowed).toBe(true)
    }
    const denied = throttle.tryConsume('1.2.3.4', now)
    expect(denied.allowed).toBe(false)
    // One token is worth refillWindowMs / capacity; tokens are fully spent.
    expect(denied.retryAfterMs).toBe(REFILL_WINDOW_MS / CAPACITY)
  })

  it('refills tokens linearly and allows again after the window', () => {
    const throttle = makeThrottle()
    const start = 1_000_000
    for (let i = 0; i < CAPACITY; i++) throttle.tryConsume('1.2.3.4', start)
    // A single token's worth of elapsed time restores exactly one token.
    expect(throttle.tryConsume('1.2.3.4', start + REFILL_WINDOW_MS / CAPACITY).allowed).toBe(true)
    expect(throttle.tryConsume('1.2.3.4', start + REFILL_WINDOW_MS / CAPACITY).allowed).toBe(false)
    // A full window restores the full bucket.
    expect(throttle.tryConsume('1.2.3.4', start + REFILL_WINDOW_MS).allowed).toBe(true)
  })

  it('treats different IPs independently', () => {
    const throttle = makeThrottle()
    const now = 1_000_000
    for (let i = 0; i < CAPACITY; i++) throttle.tryConsume('1.2.3.4', now)
    for (let i = 0; i < CAPACITY; i++) {
      expect(throttle.tryConsume('5.6.7.8', now).allowed).toBe(true)
    }
    expect(throttle.tryConsume('5.6.7.8', now).allowed).toBe(false)
  })

  it('enforces the in-flight cap and lifts it after the window elapses', () => {
    const throttle = makeThrottle()
    const start = 2_000_000
    for (let i = 0; i < MAX_IN_FLIGHT; i++) throttle.recordIssue('1.2.3.4', start)
    const denied = throttle.tryConsume('1.2.3.4', start)
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterMs).toBeGreaterThanOrEqual(1_000)
    // Once the oldest in-flight entry expires, the IP can claim again.
    expect(throttle.tryConsume('1.2.3.4', start + IN_FLIGHT_WINDOW_MS).allowed).toBe(true)
  })

  it('reset() restores a clean state for both the bucket and the in-flight cap', () => {
    const throttle = makeThrottle()
    const now = 1_000_000
    for (let i = 0; i < CAPACITY; i++) throttle.tryConsume('1.2.3.4', now)
    for (let i = 0; i < MAX_IN_FLIGHT; i++) throttle.recordIssue('5.6.7.8', now)
    throttle.reset()
    expect(throttle.tryConsume('1.2.3.4', now).allowed).toBe(true)
    expect(throttle.tryConsume('5.6.7.8', now).allowed).toBe(true)
  })
})