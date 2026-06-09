# zeroapi-go

Official Go client for the **ZeroApi** sports-odds API. Standard library only.

```bash
go get github.com/zeroapi/zeroapi-go
```

```go
package main

import (
	"fmt"
	"os"

	zeroapi "github.com/zeroapi/zeroapi-go"
)

func main() {
	c := zeroapi.New(os.Getenv("ZEROAPI_KEY"))
	// or point at your deployment:
	// c := zeroapi.NewWithBaseURL(os.Getenv("ZEROAPI_KEY"), "http://localhost:8081/api/v1")

	live, _ := c.Live("melbet")
	fmt.Println(len(live), "live matches")

	matches, _ := c.Matches("melbet", &zeroapi.MatchesParams{Status: "prematch", Limit: 20})
	if len(matches) > 0 {
		odds, _ := c.Odds("melbet", matches[0].ID)
		fmt.Println(odds)
	}

	// Full "All Sports" sidebar tree (sports + nested leagues)
	tree, _ := c.Sidebar("diamondexch")
	for _, s := range tree {
		fmt.Printf("%s (%d leagues)\n", s.Name, len(s.Leagues))
	}
}
```

## Features

- Methods for `Providers`, `Sports`, `Leagues`, `Sidebar`, `Matches`, `Match`, `Live`, `Results`, `Odds`
- `X-API-Key` auth handled for you
- Automatic retry on `429` / `5xx` with rate-limit-aware backoff (honours `Retry-After`)
- Returns `*zeroapi.Error` carrying the HTTP status on failure
