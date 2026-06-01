# @zeroapi/sdk

Official TypeScript/JavaScript client for the **ZeroApi** sports-odds API.

```bash
npm install @zeroapi/sdk
```

```ts
import { ZeroApi } from "@zeroapi/sdk";

const client = new ZeroApi({
  apiKey: process.env.ZEROAPI_KEY!,
  baseUrl: "http://localhost:8081/api/v1", // your deployment
});

const live = await client.live("melbet");
const matches = await client.matches("melbet", { status: "prematch", limit: 20 });
const detail = await client.match("melbet", matches[0].id);
console.log(detail.odds);
```

## Features

- Typed methods for `providers`, `sports`, `leagues`, `matches`, `match`, `live`, `odds`
- `X-API-Key` auth handled for you
- Automatic retry on `429` / `5xx` with rate-limit-aware backoff (honours `Retry-After`)
- Throws `ZeroApiError` with the HTTP status on failure

## Build

```bash
npm install && npm run build
```
