# nuvio-imdb-ratings

Fetches per-episode IMDb scores for the web client, which cannot fetch them
itself.

## Why it exists

The two services Nuvio reads episode scores from send no cross-origin headers.
A browser is refused outright — not a 403 it could report, but `Failed to
fetch` before the request is made. Nothing in the page can work around that.

It also keeps the upstream addresses out of the app. They are build-time
secrets in the official clients, and this repository is public: anything the
web client fetched directly would be published alongside it.

## Why it is not part of the return relay

The relay's guarantee is that it never learns what is being watched — a token
and a number of seconds is the whole of it. This receives the id of every show
you open, which is more. Folding it in would have made the relay's README
untrue, and the request budget is per account rather than per Worker, so
separating costs nothing.

## What it receives

The IMDb or TMDB id of a series. No account, no profile, no episode, nothing
about what was played. Requests are not logged.

## Endpoint

```
GET /season-ratings?imdb=tt0944947&tmdb=1399
```

Either id may be omitted. Both are validated against `^tt\d{5,12}$` and
`^\d{1,9}$` before they become part of a path on another host.

The IMDb-keyed service is asked first and the TMDB-keyed one only when the
first knows nothing — the same order, and the same "a zero vote average means
unrated" rule, as `ImdbEpisodeRatingsRepository` in the official clients.

```json
{ "ratings": { "1:1": 8.9, "1:2": 8.6 }, "source": "imdb" }
```

Flattening here rather than in the browser keeps the rule about what counts as
a rating in one place.

## Request budget

The free plan allows 100,000 requests a day per account, shared with the return
relay.

Three things keep usage far below that: answers are held at the edge for 12
hours, browsers are told to hold them for 6, and the client caches them for 30
minutes per series and shares in-flight requests. A show reopened costs
nothing, and a show someone else opened costs nothing for the next viewer.

An empty answer is cached for 15 minutes rather than 12 hours, so a series that
has no ratings yet is not written off for the rest of the day.

## Configuration

`ALLOWED_APP_HOSTS` is in `wrangler.toml`. Everything else is a secret, so
nothing here names a private address:

```bash
npx wrangler secret put IMDB_RATINGS_BASE_URL       # keyed by IMDb id
npx wrangler secret put IMDB_RATINGS_FALLBACK_URL   # keyed by TMDB id
npx wrangler secret put EXTRA_APP_HOSTS             # a private test instance
```

Only the configured origins may read an answer. That is not a defence against a
determined caller, which can send any Origin it likes — it keeps other people's
pages from using this, and keeps the CORS surface narrow.

## Deploy

```bash
npx wrangler deploy
```
