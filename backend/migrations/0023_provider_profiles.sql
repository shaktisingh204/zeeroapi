-- Per-provider PROFILE: providers are NOT interchangeable. An exchange (d247)
-- quotes back/lay/volume and suspends markets in-play; a 1xbet-family sportsbook
-- quotes a single price with market groups; 1win and bcgame come from different
-- JSON feeds again. This profile makes those differences first-class data the
-- API and UI render per provider, instead of one lowest-common-denominator shape.

ALTER TABLE providers ADD COLUMN IF NOT EXISTS kind    TEXT  NOT NULL DEFAULT 'sportsbook';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Exchange ----------------------------------------------------------------
UPDATE providers SET kind = 'exchange', profile = jsonb_build_object(
  'data_source', 'Diamond Exch (d247) SPA, rendered DOM via Playwright',
  'accent', '#6366f1',
  'blurb', 'Betting exchange. Back and lay prices with matched volume; markets lock (suspend) in-play.',
  'markets', jsonb_build_array('Match Odds','Bookmaker','Fancy','Winner'),
  'odd_fields', jsonb_build_array('value (back)','lay','volume','suspended'),
  'match_fields', jsonb_build_array('suspended','featured','header','live score')
) WHERE slug = 'diamondexch';

-- 1xbet-family sportsbooks (native + DOM) ---------------------------------
UPDATE providers SET kind = 'sportsbook', profile = jsonb_build_object(
  'data_source', '1xbet-family LineFeed / LiveFeed JSON (native Rust scraper)',
  'accent', '#34d27b',
  'blurb', 'Sportsbook. Single decimal price per outcome, with the full market-group tree.',
  'markets', jsonb_build_array('1x2','Double Chance','Total','Handicap','Individual Total','1x2 (incl. OT)'),
  'odd_fields', jsonb_build_array('value','param','group_id','type_code'),
  'match_fields', jsonb_build_array('live score','period','featured','suspended')
) WHERE slug = 'melbet';

UPDATE providers SET kind = 'sportsbook', profile = jsonb_build_object(
  'data_source', '1xBet SPA, rendered DOM',
  'accent', '#3b82f6',
  'blurb', 'Sportsbook. Single price per outcome; locked outcomes are flagged suspended.',
  'markets', jsonb_build_array('Match Result','Double Chance','Total'),
  'odd_fields', jsonb_build_array('value','param','suspended'),
  'match_fields', jsonb_build_array('live score','featured','suspended')
) WHERE slug = '1xbet';

UPDATE providers SET kind = 'sportsbook', profile = jsonb_build_object(
  'data_source', 'BetWinner SPA, rendered DOM',
  'accent', '#f59e0b',
  'blurb', 'Sportsbook. Single price per outcome; locked outcomes are flagged suspended.',
  'markets', jsonb_build_array('Match Result','Double Chance','Total'),
  'odd_fields', jsonb_build_array('value','param','suspended'),
  'match_fields', jsonb_build_array('live score','featured','suspended')
) WHERE slug = 'betwinner';

UPDATE providers SET kind = 'sportsbook', profile = jsonb_build_object(
  'data_source', 'MegaPari SPA, rendered DOM',
  'accent', '#8b5cf6',
  'blurb', 'Sportsbook. Single price per outcome; locked outcomes are flagged suspended.',
  'markets', jsonb_build_array('Match Result','Double Chance','Total'),
  'odd_fields', jsonb_build_array('value','param','suspended'),
  'match_fields', jsonb_build_array('live score','featured','suspended')
) WHERE slug = 'megapari';

-- 1win (top-parser feed) ---------------------------------------------------
UPDATE providers SET kind = 'sportsbook', profile = jsonb_build_object(
  'data_source', '1Win top-parser lp-feed JSON',
  'accent', '#ec4899',
  'blurb', 'Sportsbook on the top-parser feed. Prematch + live; blocked outcomes flagged suspended.',
  'markets', jsonb_build_array('Match Result','Total','Handicap','Both Teams To Score'),
  'odd_fields', jsonb_build_array('value','param','suspended'),
  'match_fields', jsonb_build_array('live score','period','suspended')
) WHERE slug = '1win';

-- bcgame (BetBy / sptpub) --------------------------------------------------
UPDATE providers SET kind = 'sportsbook', profile = jsonb_build_object(
  'data_source', 'BC.Game BetBy / sptpub JSON API',
  'accent', '#14b8a6',
  'blurb', 'Sportsbook on BetBy. Prematch + live, outrights, alternative market lines.',
  'markets', jsonb_build_array('1x2','Total','Handicap','Double Chance','Outright'),
  'odd_fields', jsonb_build_array('value','param'),
  'match_fields', jsonb_build_array('live score','scheduled')
) WHERE slug = 'bcgame';
