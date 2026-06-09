"""Shared ingest helpers for the ZeroApi scrapers.

The backend's /api/ingest/snapshot accepts an optional `sports` tree alongside
`matches` (see backend/src/routes/ingest.rs `Snapshot.sports`). Posting it lets a
provider expose its complete "All Sports" catalog via /api/v1/{provider}/sidebar
— including sports/leagues that have no live match right now.

These helpers are transport-agnostic: they only build the JSON body, so they work
with both sync (`client.post(...)`) and async (`await client.post(...)`) httpx
clients. Each scraper does its own POST.
"""


def sidebar_payload(provider, sports, source="sidebar"):
    """Build a snapshot body that carries only the sports-tree (no matches).

    `sports` is a list of ``{"name": str, "leagues": [{"name": str} | str, ...]}``.
    Blank names are dropped and leagues are de-duplicated per sport.
    """
    nodes = []
    for s in sports or []:
        name = (s.get("name") or "").strip()
        if not name:
            continue
        leagues, seen = [], set()
        for lg in s.get("leagues") or []:
            ln = lg.get("name") if isinstance(lg, dict) else lg
            ln = (ln or "").strip()
            if ln and ln not in seen:
                seen.add(ln)
                leagues.append({"name": ln})
        nodes.append({"name": name, "leagues": leagues})
    return {
        "source": f"{provider}-{source}",
        "provider": provider,
        "matches": [],
        "sports": nodes,
    }


def tree_from_matches(matches):
    """Aggregate ingest match dicts (each with "sport" and optional "league")
    into a sorted sports-tree ``[{"name": sport, "leagues": [{"name": league}]}]``."""
    tree = {}
    for m in matches or []:
        sport = (m.get("sport") or "").strip()
        if not sport:
            continue
        leagues = tree.setdefault(sport, set())
        lg = m.get("league")
        if isinstance(lg, str) and lg.strip():
            leagues.add(lg.strip())
    return [
        {"name": s, "leagues": [{"name": l} for l in sorted(ls)]}
        for s, ls in sorted(tree.items())
    ]


def merge_empty_sports(tree, sport_names):
    """Append catalog sports that have no matches (no leagues yet) to `tree`."""
    have = {t["name"] for t in tree}
    for n in sport_names:
        n = (n or "").strip()
        if n and n not in have:
            tree.append({"name": n, "leagues": []})
            have.add(n)
    return tree
