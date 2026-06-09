/**
 * ZeroApi TypeScript SDK — thin typed client for the public sports-odds API.
 * Auth via X-API-Key, automatic retry with rate-limit-aware backoff.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class ZeroApi {
    constructor(opts) {
        if (!opts.apiKey)
            throw new Error("ZeroApi: apiKey is required");
        this.apiKey = opts.apiKey;
        this.baseUrl = (opts.baseUrl ?? "http://localhost:8081/api/v1").replace(/\/$/, "");
        this.maxRetries = opts.maxRetries ?? 3;
    }
    async get(path, params) {
        const url = new URL(`${this.baseUrl}${path}`);
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined && v !== null)
                    url.searchParams.set(k, String(v));
            }
        }
        for (let attempt = 0;; attempt++) {
            const res = await fetch(url, { headers: { "X-API-Key": this.apiKey } });
            if (res.status === 429 || res.status >= 500) {
                if (attempt < this.maxRetries) {
                    const retryAfter = Number(res.headers.get("retry-after")) || 0;
                    await sleep(retryAfter * 1000 || 2 ** attempt * 250);
                    continue;
                }
            }
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new ZeroApiError(res.status, body?.error ?? res.statusText);
            }
            return res.json();
        }
    }
    providers() {
        return this.get("/providers");
    }
    sports(provider) {
        return this.get(`/${provider}/sports`);
    }
    leagues(provider, params) {
        return this.get(`/${provider}/leagues`, params);
    }
    /** Full "All Sports" sidebar tree: every sport with its nested leagues. */
    sidebar(provider) {
        return this.get(`/${provider}/sidebar`);
    }
    matches(provider, params) {
        return this.get(`/${provider}/matches`, params);
    }
    match(provider, id) {
        return this.get(`/${provider}/matches/${id}`);
    }
    live(provider) {
        return this.get(`/${provider}/live`);
    }
    /** Finished matches with derived winners. */
    results(provider) {
        return this.get(`/${provider}/results`);
    }
    odds(provider, matchId) {
        return this.get(`/${provider}/odds/${matchId}`);
    }
}
export class ZeroApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = "ZeroApiError";
    }
}
