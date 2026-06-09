package zeroapi_test

import (
	"fmt"
	"os"

	zeroapi "github.com/zeroapi/zeroapi-go"
)

func Example() {
	c := zeroapi.New(os.Getenv("ZEROAPI_KEY"))

	live, err := c.Live("melbet")
	if err != nil {
		panic(err)
	}
	fmt.Println(len(live), "live matches")

	// Full "All Sports" sidebar tree (sports + nested leagues).
	tree, err := c.Sidebar("diamondexch")
	if err != nil {
		panic(err)
	}
	for _, s := range tree {
		fmt.Printf("%s (%d leagues)\n", s.Name, len(s.Leagues))
	}
}
