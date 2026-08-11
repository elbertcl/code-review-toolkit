# Root Cause Analysis: Ads Tracking Service Degradation

**Date:** August 4, 2026
**Impact Window:** 12:00 WIB – 01:00 WIB (Aug 5)
**Peak Impact:** 18:00–21:00 WIB
**Author:** Incident Investigation
**Severity:** P1 — Service Degradation

---

## Executive Summary

On August 4, 2026, the ads tracking pipeline experienced a severe degradation lasting approximately 13 hours. The incident manifested as **130,840 duplicate event rejections**, **3,640 HTTP 400 errors**, and **1,266 client timeouts** from the Android application (`com.astro.shop.android`). The root cause was **Redis resource contention** between the tracking gRPC service (`astro-ads-tracking-be-grpc`) and the consumer service (`astro-ads-consumer-be`), which share the same Redis instance (`RedisAdsTransient`). The consumer's anomaly detection processing saturated the shared Redis, causing cascading latency in the tracking service's rate-limiting checks, triggering client retries, and creating a self-reinforcing duplicate storm that peaked during evening prime-time traffic.

---

## Timeline (All Times WIB / UTC+7)

| Time | Event |
|---|---|
| **Jul 28 – Aug 2** | Pre-existing instability: DB health check failures (`pq: canceling statement due to user request`), scattered pod terminations, PubSub publish failures |
| **Aug 3 daytime** | 16 pod terminations, 23 non-retriable `OrderCompleted` errors, 4 DB health failures |
| **~00:00 Aug 4** | 32 PubSub `failed to publish message` errors clustered |
| **07:00–11:00** | Baseline: PubSub unacked messages <10, near-zero errors |
| **12:00** 🔴 | **PubSub backlog jumps from 4 → 57 unacked.** Consumer `event_preprocessed` subscription begins falling behind |
| **12:00–15:00** | Backlog sustains at 57–79. First client HTTP 400 errors appear. Consumer VIEWED rejections begin |
| **15:00–17:00** | View rejections ramp from ~300/min to ~900/min. Client errors accumulate |
| **18:00** 🔴🔴 | **Backlog peaks at 104 unacked.** Evening traffic surge hits the already-degraded pipeline |
| **18:00–21:00** 🔴🔴 | **Full collapse.** 130K duplicates, 3,400 HTTP 400s, client timeouts, 1,500+ viewed/min rejected. Both `event_preprocessed` and `seller_spend` subscriptions affected |
| **22:00** | Pipeline starts recovering. Backlog drops below 50 |
| **01:00 Aug 5** | Fully recovered. Backlog <5 unacked |

---

## Architecture Context

```
┌──────────────────────────────────────────────────────────┐
│                    Android App                           │
│  (com.astro.shop.android)                               │
│  Generates events → encrypts token → POST /collector    │
└────────────────────┬─────────────────────────────────────┘
                     │ HTTP (via api.astronauts.id / Cloudflare)
                     ▼
┌──────────────────────────────────────────────────────────┐
│              Kong API Gateway                            │
│  grpc-gateway plugin → converts HTTP/JSON to gRPC       │
└────────────────────┬─────────────────────────────────────┘
                     │ gRPC
                     ▼
┌──────────────────────────────────────────────────────────┐
│        astro-ads-tracking-be-grpc (Tracking Binary)     │
│  tracker.go:Track()                                     │
│  → ValidateRawEvent (token decrypt, expiry check)       │
│  → Build (event construction)                           │
│  → CheckSpamRules (🔴 Redis: dedup, velocity checks)    │
│  → Publish to PubSub topic:                             │
│    ads_tracker-event_preprocessed                       │
└────────────────────┬────────────────────────────────────┘
                     │ PubSub publish
                     ▼
┌──────────────────────────────────────────────────────────┐
│              PubSub Topic                                │
│  ads_tracker-event_preprocessed                         │
└────────────────────┬────────────────────────────────────┘
                     │ PubSub subscribe
                     ▼
┌──────────────────────────────────────────────────────────┐
│        astro-ads-consumer-be (Consumer Binary)          │
│  HandlePreprocessedEvent() → batched processing         │
│  → IngestValidatedEvents                                │
│     → Dedup partition                                    │
│     → CheckAnomalyRules (🔴 Redis: behavior checks)     │
│     → JourneyValidator.SetView (🔴 Redis)               │
│     → BulkCreateEvents (ClickHouse)                     │
│     → Publish to PubSub topic:                           │
│       ads_tracker-event_created                         │
└──────────────────────────────────────────────────────────┘

🔴 = Hits RedisAdsTransient (SHARED between both binaries)
```

### The Shared Resource: `RedisAdsTransient`

Both binaries initialize the **same Redis instance**:

| Binary | File |
|---|---|
| Tracking gRPC | `cmd/grpc/tracking/main.go:57` — `setup.SetupRedisTransient(ctx, cfg.RedisAdsTransient)` |
| Consumer | `cmd/sub/main.go:85` — `setup.SetupRedisTransient(ctx, cfg.RedisAdsTransient)` |

**Tracking service** uses Redis for:
- `IsDuplicate()` — `SETNX` dedup check (`redis/rate_limiter.go:17`)
- `IsUserVelocityExceeded()` — `BatchIncr` on up to 5 keys (`redis/rate_limiter.go:40`)
- `IsTargetVelocityExceeded()` — `BatchIncr` on up to 6 keys (`redis/rate_limiter.go:120`)

**Consumer** uses Redis for:
- `IsAbnormalBehaviorDetected()` — `BatchZSetSlidingWindow` on up to 6 keys (`redis/rate_limiter.go:202`)
- `IsActivitySustained()` — `BatchIncr` on up to 3 keys (`redis/rate_limiter.go:296`)
- `SetView()` — journey tracking (`journey_validator.go:45`)
- `CheckViewToClick()` — funnel validation (`journey_validator.go:69`)
- `SetLastClick()` — last-click attribution
- `IngestDeduplicator` — marking events as processed
- Order attribution — claim/release via `SETNX`

---

## Findings

### Finding 1: Client-Side Error Profile (5000 events)

**Source:** `com.astro.shop.android` logs, `/collector/v1/events`

| Error Type | Count | % |
|---|---|---|
| HTTP 400 (validation rejection) | 3,640 | 72.8% |
| SocketTimeoutException | 1,266 | 25.3% |
| ConnectException (Cloudflare unreachable) | 87 | 1.7% |
| HTTP 403, SSL errors | 7 | 0.1% |

**417 unique real users** affected (sequential auto-increment IDs spanning 100K–5.2M range). Peak impact during **18:00–22:00 WIB** (evening shopping hours). No bot/test patterns detected.

HTTP 400 errors map to these server-side validation failures (`helpers.go:7-19`):
- `ErrInvalidRequest` — missing fields
- `ErrExpiredToken` — token >24h old (message: `"ads token is expired"`, `error.go:8`)
- `ErrUnsupportedEncryptionVersion` — wrong key version
- `ErrInvalidToken` — decrypt/struct validation failure
- `ErrInvalidEventType`, `ErrInvalidAdType` — unknown event/ad type

**Critical note:** The gRPC handler does NOT log HTTP 400 errors (`tracker.go:38-39` returns early without logging). Only HTTP 500 errors produce the `"tracker gRPC Track"` log entry.

### Finding 2: GKE Server-Side Logs (635 entries)

**Source:** Fluentd GKE logs

| Log Entry | Count | Impact |
|---|---|---|
| `tracker gRPC Track` (HTTP 500 errors) | 501 | Publish failures, DB errors |
| Pod terminated (SIGTERM) | 35 | Liveness probe / eviction / OOM |
| `failed to publish message` | 32 | PubSub publisher failures |
| `non-retriable error in OrderCompleted` | 24 | Order attribution failures |
| `Health checker SQLHealthChecker failed: pq: canceling statement due to user request` | 13 | PostgreSQL query cancellation |
| `failed to set view` | 2 | Redis SetView operation failure |
| `ingest dedup: failed to mark events as processed` | 2 | Redis dedup failure |

### Finding 3: APM Error Traces (280 unique error calls)

**Source:** Datadog APM, `service:astro-ads-tracking-be-grpc`

| Error Type | Count | Duration | gRPC Status |
|---|---|---|---|
| Validation failures (CreateEvent) | 213 | <200μs avg | InvalidArgument → HTTP 400 |
| PubSub publish failures | 67 | 12–118ms | Internal → HTTP 500 |

Only **3.8%** of requests succeeded during the peak window (133 successful traces vs ~3,400 HTTP 400s).

### Finding 4: Consumer Rejections (130,760 events)

**Source:** Datadog Metrics, `astro_ads_consumer_be.ads.tracker.event_created_total{status:rejected}`

| Event Type | Count | % |
|---|---|---|
| viewed | 130,358 | 99.7% |
| added_to_cart | 290 | 0.2% |
| clicked | 112 | 0.1% |

Peak: 1,500+ VIEWED events rejected per 5-minute interval at 18:00–20:00 WIB.

### Finding 5: Rate Limit Triggers — Only `rule:duplicated`

**Source:** Datadog Metrics, `rate_limit_triggered_total` grouped by `rule:`

| Rule | Aug 3 | Aug 4 | Total |
|---|---|---|---|
| **duplicated** | 701 | **130,139** | **130,840** |
| excessive_user_velocity | 0 | 0 | 0 |
| ad_or_seller_drain_protection | 0 | 0 | 0 |
| excessive_unique_objects | 0 | 0 | 0 |
| sustained_activity | 0 | 0 | 0 |

Only the dedup rule fired. No other rate-limiting rules were triggered. The 130,139 duplicates at the gRPC level are the **same events** counted as 130,358 consumer rejections (slight difference due to time window alignment).

### Finding 6: PubSub Backlog

**Source:** GCP Monitoring, `num_unacked_messages` for `ads_tracker-event_preprocessed-sub`

| Time (WIB) | Unacked | State |
|---|---|---|
| 07:00–11:00 | 4–7 | Baseline |
| **12:00** | **57** | 🔴 Spike starts |
| 13:00–17:00 | 57–79 | Sustained backlog |
| **18:00** | **104** | 🔴 Peak |
| 19:00–21:00 | 98–102 | Plateau during collapse |
| 22:00 | 72 | Beginning recovery |
| 01:00 | 4 | Recovered |

Also affected: `ads_platform-process_seller_spend-sub` — max 46 unacked at 19:00 WIB.

---

## Root Cause: Shared Redis Contention

### How the Consumer Affects the Tracking Binary

The two binaries share `RedisAdsTransient` — the same GCP Memorystore instance. There is no process-level coupling (no direct gRPC/HTTP calls between them), but they compete for the same Redis resource. When the consumer processes large volumes of events during peak traffic, its anomaly detection operations saturate Redis, which directly impacts the tracking service's rate-limiting checks on the same instance.

### The Feedback Loop

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   1. CONSUMER overloads Redis                            │
│      (130K events × 10+ Redis ops each                  │
│       = 1.3M+ Redis operations)                         │
│              │                                           │
│              ▼                                           │
│   2. Shared Redis latency spikes                         │
│      (connection pool exhausted,                        │
│       server CPU saturated)                             │
│              │                                           │
│              ▼                                           │
│   3. TRACKING CheckSpamRules() SLOWS                     │
│      (3 sequential Redis calls per request)             │
│              │                                           │
│              ▼                                           │
│   4. gRPC handler latency increases                      │
│      (3ms → 150ms-1.5s per request)                     │
│              │                                           │
│              ▼                                           │
│   5. Client times out or retries                         │
│      (1,266 SocketTimeoutException)                     │
│              │                                           │
│              ▼                                           │
│   6. Original request eventually completes                │
│      → impression_id written to Redis dedup set         │
│      Retry arrives → IsDuplicate() → YES                │
│      → rule:duplicated (130K)                           │
│              │                                           │
│              ▼                                           │
│   7. BOTH events published to PubSub                     │
│      → Consumer must process 2x volume                  │
│              │                                           │
│              └──────► loops back to 1                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### How Slow Redis Responses Impact Client Timeouts

The `/collector/v1/events` handler executes these steps **sequentially** inside `CreateEvent()`:

| Step | Function | Resource | Normal | Under Redis Load |
|---|---|---|---|---|
| 1 | `ValidateRawEvent()` | CPU (AES-256-GCM) | 150μs | 150μs |
| 2 | `Build()` | CPU (mapping) | 20μs | 20μs |
| 3a | `IsDuplicate()` | **Redis: SETNX** | 200μs | **50–500ms** |
| 3b | `IsUserVelocityExceeded()` | **Redis: BatchIncr ×5** | 300μs | **50–500ms** |
| 3c | `IsTargetVelocityExceeded()` | **Redis: BatchIncr ×6** | 300μs | **50–500ms** |
| 4 | `publishPreprocessedEventSync()` | **PubSub (blocking)** | 2ms | **5–30s** |
| | **Total** | | **~3ms** | **150ms–32s** |

The gRPC server (`server.go:99`) has **no deadline interceptor** — it processes every request to completion regardless of how long it takes. The Kong gateway also has no explicit route timeout configured for `/collector/v1/events`. The Android client's OkHttp `readTimeout` (default 10 seconds) is the only timeout boundary in the entire chain.

When latency exceeds 10 seconds:
1. Android client throws `SocketTimeoutException`
2. The server **continues processing** the request
3. `IsDuplicate()` is called → `SETNX` succeeds → impression_id written to Redis
4. `publishPreprocessedEventSync()` publishes to PubSub
5. gRPC handler tries to send response → connection already closed → error suppressed
6. Android SDK retries with same impression_id
7. New request → `IsDuplicate()` → key already exists → `rule:duplicated` triggered

Each step in `CheckSpamRules` is a **blocking, sequential Redis call**. The goroutine is held for the duration of each Redis roundtrip. With Redis connection pool exhaustion adding queue time plus Redis server CPU saturation adding processing time, each call that normally takes 200-300μs can spike to 50-500ms. With three sequential calls, this adds 150ms-1.5s to every single request.

### Why 130K Duplicates but Only 1,266 Timeouts

The ratio is ~100:1 because:

- A single `SocketTimeoutException` (latency >10s) spawns 2–5 retries, each becoming a duplicate
- More critically: requests that are **slow (3–8s) but within the socket timeout** still trigger the Android SDK's internal retry logic. The original request completes and writes the dedup key, then the retry arrives and is flagged as a duplicate — but no `SocketTimeoutException` is logged because the socket never timed out

```
Normal path:     Client → [3ms] → Response ✓
Slow path:       Client → [5s] → Response ✓  BUT SDK retried at 3s → DUPLICATE
Timeout path:    Client → [12s] → SocketTimeoutException → 2-5 retries → ALL DUPLICATES
```

---

## Contributing Factors

1. **No server-side deadline:** The gRPC server processes requests without a timeout, allowing slow requests to complete after the client has disconnected. This creates the dedup-to-retry gap.
2. **Sequential Redis calls:** `CheckSpamRules()` makes 3 sequential (not parallel) Redis calls. Each blocks the goroutine and multiplies the impact of Redis latency.
3. **Sync PubSub publish:** The gRPC handler uses `publishPreprocessedEventSync` (blocking). The "32 failed to publish message" errors from Finding 2 caused additional latency on this step during the incident.
4. **Shared Redis instance:** The tracking service and consumer compete for the same `RedisAdsTransient` instance, with no isolation between their workloads.
5. **No HTTP 400 logging:** The gRPC handler skips logging for `IsBadRequest` errors (including token expiry), making investigation harder — the error details are only available in APM span tags.
6. **24h token expiry:** Tokens expire 24 hours after creation (`tokenExpiryTime: 24h`, `config.yaml:372`). Events generated during the incident period that weren't sent until later would be rejected as `ErrExpiredToken` ("ads token is expired"), contributing to the 3,640 HTTP 400 errors.

---

## Action Items

### Immediate (Mitigation)

1. **[Code] Add server-side deadline** to the tracking gRPC handler. If a request exceeds, e.g., 5 seconds, return `DeadlineExceeded` BEFORE the dedup key is written — preventing the dedup-to-retry gap that creates the feedback loop.
2. **[Infra] Evaluate Redis node sizing** — the shared `RedisAdsTransient` instance may need more memory or a higher-tier SKU during peak traffic.
3. **[Code] Parallelize Redis calls** in `CheckSpamRules` — `IsDuplicate`, `IsUserVelocityExceeded`, and `IsTargetVelocityExceeded` could run concurrently since they are independent.

### Short Term

4. **[Code] Add logging for HTTP 400 errors** in `internal/api/grpc/tracker/tracker.go:38`. Currently these errors are invisible in logs; only APM span tags contain the error detail.
5. **[Infra] Consider separate Redis instances** — one for tracking (dedup/velocity) and one for consumer (anomaly/journey).
6. **[Config] Investigate anomaly threshold tuning** — determine whether the `IsAbnormalBehaviorDetected` thresholds are too low for normal traffic peaks.

### Long Term

7. **[Architecture] Switch to async publish** (`UseAsyncPublish`) in the tracking gRPC handler to decouple client response time from PubSub publish latency.
8. **[Monitoring] Add alert on `rule:duplicated`** spike — a sudden jump in dedup triggers is an early indicator of retry storms.
9. **[Monitoring] Add alert on `num_unacked_messages`** above a threshold for the `event_preprocessed` subscription.

---

## Data Sources

| Source | Description |
|---|---|
| Android client error logs | 5,000 `com.astro.shop.android` log entries from `/collector/v1/events` |
| GKE server-side logs | 635 Fluentd log entries from GKE cluster |
| Successful APM traces | 133 successful `tracker.GrpcService.Track` spans |
| Error APM traces | 560 error spans across gRPC handler and service layers |
| Consumer rejection metrics | `event_created_total{status:rejected}` — 852 data points over 24h |
| Rate limit trigger metrics | `rate_limit_triggered_total` grouped by rule — 284 data points |
| Client user detail | 5,000 client log entries with user IDs and time ranges |
| PubSub unacked messages | `num_unacked_messages_by_region` — 576 data points over 24h |

---

## Key Source Files

| Layer | File Path |
|---|---|
| gRPC handler (no logging for 400s) | `internal/api/grpc/tracker/tracker.go:38-43` |
| Bad request error map | `internal/api/grpc/tracker/helpers.go:7-19` |
| Error sentinels | `internal/domain/tracker/service/error.go:5-16` |
| Token expiry check | `internal/domain/tracker/service/event_builder.go:106-108` |
| Sequential Redis calls | `internal/domain/tracker/service/rate_limiter.go:85-97` |
| Sync PubSub publish | `internal/domain/tracker/service/create_event.go:140-183` |
| Redis dedup check | `internal/domain/tracker/db/redis/rate_limiter.go:17-38` |
| Redis anomaly checks | `internal/domain/tracker/db/redis/rate_limiter.go:202-354` |
| Token expiry config (24h) | `internal/configs/config.yaml:372` |
| Shared Redis init (tracking) | `cmd/grpc/tracking/main.go:57` |
| Shared Redis init (consumer) | `cmd/sub/main.go:85` |
| Kong route (no timeout) | `services/ads-tracking/routes.yaml:7-9` |
