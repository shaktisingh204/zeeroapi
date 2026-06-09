// Package zeroapi is the official Go client for the ZeroApi sports-odds API.
//
// Auth is via the X-API-Key header. Requests automatically retry on 429 / 5xx
// with rate-limit-aware backoff (honouring Retry-After). Errors are returned as
// *Error carrying the HTTP status.
//
//	c := zeroapi.New(os.Getenv("ZEROAPI_KEY"))
//	live, err := c.Live("melbet")
package zeroapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DefaultBaseURL is used when New is called without an explicit base URL.
const DefaultBaseURL = "http://localhost:8081/api/v1"

// Client is a ZeroApi API client.
type Client struct {
	BaseURL    string
	APIKey     string
	HTTP       *http.Client
	MaxRetries int
}

// New returns a Client using the default base URL.
func New(apiKey string) *Client {
	return NewWithBaseURL(apiKey, DefaultBaseURL)
}

// NewWithBaseURL returns a Client pointed at a specific deployment.
func NewWithBaseURL(apiKey, baseURL string) *Client {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	return &Client{
		BaseURL:    strings.TrimRight(baseURL, "/"),
		APIKey:     apiKey,
		HTTP:       &http.Client{Timeout: 30 * time.Second},
		MaxRetries: 3,
	}
}

// Error is returned for any non-2xx response.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("zeroapi: [%d] %s", e.Status, e.Message) }

// ---- response types ----

type Provider struct {
	Slug         string          `json:"slug"`
	Name         string          `json:"name"`
	BaseURL      string          `json:"base_url"`
	IsActive     bool            `json:"is_active"`
	Capabilities json.RawMessage `json:"capabilities"`
}

type Sport struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	Slug       string  `json:"slug"`
	IsActive   bool    `json:"is_active"`
	MatchCount int     `json:"match_count"`
	LogoURL    *string `json:"logo_url"`
	Provider   string  `json:"provider"`
}

type League struct {
	ID         int64   `json:"id"`
	SportID    int64   `json:"sport_id"`
	SportName  string  `json:"sport_name"`
	Name       string  `json:"name"`
	Country    *string `json:"country"`
	MatchCount int64   `json:"match_count"`
}

type SidebarLeague struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	Country    *string `json:"country"`
	MatchCount int64   `json:"match_count"`
}

type SidebarSport struct {
	ID         int64           `json:"id"`
	Name       string          `json:"name"`
	Slug       string          `json:"slug"`
	MatchCount int             `json:"match_count"`
	LogoURL    *string         `json:"logo_url"`
	Leagues    []SidebarLeague `json:"leagues"`
}

type Match struct {
	ID         int64   `json:"id"`
	Provider   string  `json:"provider"`
	SportID    int64   `json:"sport_id"`
	SportName  string  `json:"sport_name"`
	LeagueID   *int64  `json:"league_id"`
	LeagueName *string `json:"league_name"`
	HomeTeam   string  `json:"home_team"`
	AwayTeam   string  `json:"away_team"`
	HomeLogo   *string `json:"home_logo"`
	AwayLogo   *string `json:"away_logo"`
	StartTime  *string `json:"start_time"`
	Status     string  `json:"status"`
	HomeScore  *int    `json:"home_score"`
	AwayScore  *int    `json:"away_score"`
	Period     *string `json:"period"`
	MatchTime  *string `json:"match_time"`
	UpdatedAt  string  `json:"updated_at"`
}

type Odd struct {
	ID        int64   `json:"id"`
	MatchID   int64   `json:"match_id"`
	Market    string  `json:"market"`
	Outcome   string  `json:"outcome"`
	Value     string  `json:"value"`
	Param     *string `json:"param"`
	UpdatedAt string  `json:"updated_at"`
}

// MatchDetail is a single match plus its full odds list.
type MatchDetail struct {
	Match
	Odds []Odd `json:"odds"`
}

// MatchesParams are the optional filters for Matches.
type MatchesParams struct {
	Status   string // "live" | "prematch" | "finished"
	SportID  int64
	LeagueID int64
	Search   string
	Limit    int
	Offset   int
}

func (p *MatchesParams) query() url.Values {
	v := url.Values{}
	if p == nil {
		return v
	}
	if p.Status != "" {
		v.Set("status", p.Status)
	}
	if p.SportID != 0 {
		v.Set("sport_id", strconv.FormatInt(p.SportID, 10))
	}
	if p.LeagueID != 0 {
		v.Set("league_id", strconv.FormatInt(p.LeagueID, 10))
	}
	if p.Search != "" {
		v.Set("search", p.Search)
	}
	if p.Limit != 0 {
		v.Set("limit", strconv.Itoa(p.Limit))
	}
	if p.Offset != 0 {
		v.Set("offset", strconv.Itoa(p.Offset))
	}
	return v
}

// ---- endpoints ----

// Providers lists the active providers.
func (c *Client) Providers() ([]Provider, error) {
	var out []Provider
	return out, c.get("/providers", nil, &out)
}

// Sports lists a provider's sports.
func (c *Client) Sports(provider string) ([]Sport, error) {
	var out []Sport
	return out, c.get("/"+provider+"/sports", nil, &out)
}

// Leagues lists a provider's leagues, optionally filtered by sportID (0 = all).
func (c *Client) Leagues(provider string, sportID int64) ([]League, error) {
	q := url.Values{}
	if sportID != 0 {
		q.Set("sport_id", strconv.FormatInt(sportID, 10))
	}
	var out []League
	return out, c.get("/"+provider+"/leagues", q, &out)
}

// Sidebar returns the full "All Sports" tree: sports with nested leagues.
func (c *Client) Sidebar(provider string) ([]SidebarSport, error) {
	var out []SidebarSport
	return out, c.get("/"+provider+"/sidebar", nil, &out)
}

// Matches lists matches with optional filters.
func (c *Client) Matches(provider string, params *MatchesParams) ([]Match, error) {
	var out []Match
	return out, c.get("/"+provider+"/matches", params.query(), &out)
}

// Match returns one match plus its odds.
func (c *Client) Match(provider string, id int64) (*MatchDetail, error) {
	var out MatchDetail
	return &out, c.get("/"+provider+"/matches/"+strconv.FormatInt(id, 10), nil, &out)
}

// Live returns a provider's live matches.
func (c *Client) Live(provider string) ([]Match, error) {
	var out []Match
	return out, c.get("/"+provider+"/live", nil, &out)
}

// Results returns finished matches with derived winners.
func (c *Client) Results(provider string) ([]Match, error) {
	var out []Match
	return out, c.get("/"+provider+"/results", nil, &out)
}

// Odds returns all odds for a match.
func (c *Client) Odds(provider string, matchID int64) ([]Odd, error) {
	var out []Odd
	return out, c.get("/"+provider+"/odds/"+strconv.FormatInt(matchID, 10), nil, &out)
}

// ---- transport ----

func (c *Client) get(path string, query url.Values, out interface{}) error {
	u := c.BaseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequest(http.MethodGet, u, nil)
		if err != nil {
			return err
		}
		req.Header.Set("X-API-Key", c.APIKey)

		resp, err := c.HTTP.Do(req)
		if err != nil {
			if attempt < c.MaxRetries {
				time.Sleep(backoff(attempt))
				continue
			}
			return err
		}

		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			if attempt < c.MaxRetries {
				d := retryAfter(resp)
				resp.Body.Close()
				if d == 0 {
					d = backoff(attempt)
				}
				time.Sleep(d)
				continue
			}
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return &Error{Status: resp.StatusCode, Message: errMessage(body, resp.Status)}
		}
		return json.Unmarshal(body, out)
	}
}

func backoff(attempt int) time.Duration {
	return time.Duration(250*(1<<uint(attempt))) * time.Millisecond
}

func retryAfter(resp *http.Response) time.Duration {
	if v := resp.Header.Get("Retry-After"); v != "" {
		if secs, err := strconv.Atoi(v); err == nil {
			return time.Duration(secs) * time.Second
		}
	}
	return 0
}

func errMessage(body []byte, fallback string) string {
	var e struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &e) == nil && e.Error != "" {
		return e.Error
	}
	if len(body) > 0 {
		return string(body)
	}
	return fallback
}
