/**
 * OTLP/HTTP JSON exporter — replaces the former Datadog pusher.
 *
 * Wire format: OTLP/HTTP JSON (opentelemetry.io/docs/specs/otlp — "JSON Protobuf Encoding").
 * POST to `${endpoint}` (e.g. https://otlp-dev.astronauts.id/v1/metrics) with
 * `Content-Type: application/json` and a standard `Authorization` header. The body is a
 * JSON-encoded ExportMetricsServiceRequest (proto3 JSON mapping: lowerCamelCase keys,
 * 64-bit ints as decimal strings, enums as integers).
 *
 * Live-probe verified 2026-08-28 against otlp-dev.astronauts.id: the server is a gRPC-gateway
 * and rejects missing auth with HTTP 401 {"code":16,"message":"missing or empty authorization
 * header: Authorization"} — hence the raw header value (e.g. "Bearer <token>") is passed whole.
 *
 * Push is best-effort by design: failures are reported to the caller and must never fail
 * the review run.
 */
export const OTEL_SCOPE_NAME = "code-review-toolkit";
export const DEFAULT_OTLP_ENDPOINT = "https://otlp-dev.astronauts.id/v1/metrics";
/** Resource attributes applied to every export — stable service identity for dashboards. */
export function buildResourceAttributes(extra) {
    const attrs = { ...extra };
    attrs["service.name"] = "code-review-toolkit"; // pinned: callers cannot spoof service identity
    return Object.entries(attrs).map(([key, value]) => ({ key, value: { stringValue: value } }));
}
export function buildOtlpRequest(metrics, resourceAttrs, tsMs) {
    const tsNano = (BigInt(Math.floor(tsMs)) * 1000000n).toString();
    return {
        resourceMetrics: [{
                resource: { attributes: buildResourceAttributes(resourceAttrs) },
                scopeMetrics: [{
                        scope: { name: OTEL_SCOPE_NAME },
                        metrics: metrics.map((m) => ({
                            name: m.name,
                            gauge: {
                                dataPoints: [{
                                        ...(m.attributes && Object.keys(m.attributes).length > 0
                                            ? {
                                                attributes: Object.entries(m.attributes).map(([key, value]) => ({
                                                    key,
                                                    value: { stringValue: value },
                                                })),
                                            }
                                            : {}),
                                        timeUnixNano: tsNano,
                                        asDouble: m.value,
                                    }],
                            },
                        })),
                    }],
            }],
    };
}
/** Retryable per the OTLP/HTTP spec: 429, 502, 503, 504. Everything else must not be retried. */
export function isRetryableOtlpStatus(status) {
    return status === 429 || status === 502 || status === 503 || status === 504;
}
export async function pushToOtlp(endpoint, authHeader, body, timeoutMs = 10_000) {
    try {
        const resp = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(authHeader ? { Authorization: authHeader } : {}),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const result = { ok: resp.ok, status: resp.status };
        if (resp.ok) {
            try {
                const text = await resp.text();
                if (text) {
                    const parsed = JSON.parse(text);
                    const rejected = Number(parsed.partialSuccess?.rejectedDataPoints ?? 0);
                    if (rejected > 0 || parsed.partialSuccess?.errorMessage) {
                        result.partial = {
                            rejectedDataPoints: rejected,
                            errorMessage: parsed.partialSuccess?.errorMessage,
                        };
                    }
                }
            }
            catch {
                // response body optional on success — ignore unparseable bodies
            }
        }
        else {
            result.error = await resp.text().catch(() => "");
        }
        return result;
    }
    catch (error) {
        return { ok: false, status: 0, error: error.message };
    }
}
/**
 * Shared CLI wiring for both pushers. Reads env:
 *   OTEL_EXPORTER_OTLP_ENDPOINT — full URL including /v1/metrics (default: astronauts dev collector)
 *   OTEL_EXPORTER_OTLP_AUTH     — raw Authorization header value, e.g. "Bearer <token>".
 *                                 Empty/absent → skip push silently (opt-out preserved).
 *   OTEL_EXPORTER_OTLP_TIMEOUT_MS — optional timeout override (default 10000)
 * Returns null when the push is opted out; callers exit 0 without network I/O.
 */
export function readOtlpConfigFromEnv() {
    const authHeader = process.env.OTEL_EXPORTER_OTLP_AUTH || "";
    if (!authHeader)
        return null;
    return {
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || DEFAULT_OTLP_ENDPOINT,
        authHeader,
        timeoutMs: Number(process.env.OTEL_EXPORTER_OTLP_TIMEOUT_MS || 10_000),
    };
}
//# sourceMappingURL=otlp.js.map