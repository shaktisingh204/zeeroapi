"""ZeroApi Python SDK — thin client for the public sports-odds API.

Auth via X-API-Key, automatic retry with rate-limit-aware backoff.
"""
from __future__ import annotations

import time
from typing import Any, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json

__all__ = ["ZeroApi", "ZeroApiError"]


class ZeroApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"[{status}] {message}")
        self.status = status
        self.message = message


class ZeroApi:
    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:8081/api/v1",
        max_retries: int = 3,
    ):
        if not api_key:
            raise ValueError("api_key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries

    def _get(self, path: str, params: Optional[dict] = None) -> Any:
        url = f"{self.base_url}{path}"
        if params:
            clean = {k: v for k, v in params.items() if v is not None}
            if clean:
                url += "?" + urlencode(clean)
        for attempt in range(self.max_retries + 1):
            req = Request(url, headers={"X-API-Key": self.api_key})
            try:
                with urlopen(req) as resp:
                    return json.loads(resp.read().decode())
            except HTTPError as e:
                if (e.code == 429 or e.code >= 500) and attempt < self.max_retries:
                    retry_after = int(e.headers.get("Retry-After", 0) or 0)
                    time.sleep(retry_after or (2 ** attempt) * 0.25)
                    continue
                try:
                    body = json.loads(e.read().decode())
                    msg = body.get("error", str(e))
                except Exception:
                    msg = str(e)
                raise ZeroApiError(e.code, msg)

    # --- Endpoints ---
    def providers(self) -> list:
        return self._get("/providers")

    def sports(self, provider: str) -> list:
        return self._get(f"/{provider}/sports")

    def leagues(self, provider: str, sport_id: Optional[int] = None) -> list:
        return self._get(f"/{provider}/leagues", {"sport_id": sport_id})

    def sidebar(self, provider: str) -> list:
        """Full 'All Sports' sidebar tree: every sport with its nested leagues."""
        return self._get(f"/{provider}/sidebar")

    def matches(self, provider: str, **params) -> list:
        return self._get(f"/{provider}/matches", params)

    def match(self, provider: str, match_id: int) -> dict:
        return self._get(f"/{provider}/matches/{match_id}")

    def live(self, provider: str) -> list:
        return self._get(f"/{provider}/live")

    def results(self, provider: str) -> list:
        """Finished matches with derived winners."""
        return self._get(f"/{provider}/results")

    def odds(self, provider: str, match_id: int) -> list:
        return self._get(f"/{provider}/odds/{match_id}")
