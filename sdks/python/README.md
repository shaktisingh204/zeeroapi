# zeroapi (Python)

Official Python client for the **ZeroApi** sports-odds API. Zero dependencies (stdlib only).

```bash
pip install zeroapi
```

```python
import os
from zeroapi import ZeroApi

client = ZeroApi(api_key=os.environ["ZEROAPI_KEY"], base_url="http://localhost:8081/api/v1")

live = client.live("melbet")
matches = client.matches("melbet", status="prematch", limit=20)
detail = client.match("melbet", matches[0]["id"])
print(detail["odds"])
```

## Features

- Methods for `providers`, `sports`, `leagues`, `matches`, `match`, `live`, `odds`
- `X-API-Key` auth handled for you
- Automatic retry on `429` / `5xx` with rate-limit-aware backoff (honours `Retry-After`)
- Raises `ZeroApiError` with the HTTP status on failure
