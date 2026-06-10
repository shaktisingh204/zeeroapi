-- d247 (diamondexch) exposes EXACTLY 6 endpoints: sports, matches,
-- matchdetails/:id, leagues, sidebar, headermatches. Odds are returned inside
-- matchdetails, so it has no separate odds/live endpoint. Trim its capabilities
-- to match (keeps the capability chips + gating honest).
UPDATE providers
   SET capabilities = '["sports","leagues","matches","exchange"]'
 WHERE slug = 'diamondexch';
