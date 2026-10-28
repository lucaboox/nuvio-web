# Return relay

Carries a playback position from an external player back into the installed
iOS web app.

## Why it exists

An installed iOS web app cannot be reached by URL. iOS opens it at its own
start address and throws away the path and query, and Safari — where a
player's callback lands — is a separate storage container that is signed out
and knows nothing about what was playing. So Outplayer can report exactly
where it stopped, and there is no route for that number to reach the app.

Routing the callback through Shortcuts does not help either. A player appends
`position` to the address it was handed, so on a `shortcuts://` address it
lands beside the `text` being passed on rather than inside it, and Shortcuts
drops what it does not recognise.

This relay is the first and only point in the chain that sees the number,
because the callback reaches it as an ordinary HTTP request.

## What it holds

A token and two integers, for as long as it takes the app to ask — deleted on
collection, or after five minutes if nobody collects. It never receives what
is being watched, the stream URL, the addon, or anything about the account.

## What is exposed

**The stream URL may or may not reach the relay, and the callback is shaped so
that it does not have to.** Outplayer appends `url`, `position` and `duration`
to whatever address it was handed. The address handed to it ends in a
fragment — `#nuvio` — and a fragment is never sent to a server. So:

- If the player appends plainly, its parameters land after the `#`. The server
  receives only the token, the outcome and the app host; the stream URL never
  goes on the wire at all. The page reads the position out of the fragment on
  the device and posts back that alone.
- If the player parses the address first, its parameters land in the query and
  the server sees them, the stream URL included. Nothing is worse than it would
  otherwise have been, and the position still arrives.

Which of the two happens is a property of the player. **Outplayer does the
second**, measured rather than assumed: it parses the address and its
parameters land in the query, so with Outplayer the stream URL is sent. The
fragment is kept anyway — it costs a character and would take effect for any
player that appends plainly, or if Outplayer ever changes. SenPlayer does the
same, measured on its macOS build (6.2.2): it re-encodes the address, appends
the stream URL as `lastPlayedUrl` and the position to the query ahead of the
fragment, and sends no duration.

This is not a gap left in the design, and no rearrangement closes it. Recovering
a position at all requires an `https` receiver, because that is the only kind of
address a player's appended parameters survive into; and that receiver's request
line is where the player also puts the stream URL. So automatic position and
zero transmission cannot both be had. The alternative is not a cleverer route,
it is the prompt: leave the relay unset and nothing is sent anywhere, at the
cost of typing where you stopped.

In the second case it is worth weighing whether a stream URL carries an access
token. Most debrid links are short-lived and tied to the requesting IP, which
limits what a copy is worth later, but it is not nothing. The relay never reads,
stores or echoes the URL in either case, the page sets `Referrer-Policy:
no-referrer` and `Cache-Control: no-store` so the address travels no further,
and it sits in that device's Safari history regardless.

**The token is the only thing protecting a report.** It is 128 bits from the
platform's own generator, and there is nothing to enumerate. The CORS check on
collection restricts browsers to the configured hosts, but an `Origin` header
can be set by anything that is not a browser — treat it as tidiness, not as
access control. Knowing a token is the whole of the permission, which is why
the slot is emptied on the first read.

**Writes are unauthenticated.** Anyone who learns the relay's address can
create slots. Nothing readable comes of it — they would be writing to tokens
nobody will collect — but it consumes the daily write allowance, so the honest
protection is that a `workers.dev` address nobody has been given is not worth
guessing at. The free plan fails closed rather than billing. Slots delete
themselves five minutes after they are written, so nothing accumulates.

**What never reaches it:** what is being watched, which addon served it, the
library, the account, or any credential.

## Deploying

```bash
cd worker
npx wrangler deploy
```

`ALLOWED_APP_HOSTS` in `wrangler.toml` lists the public hosts. A private
instance is added separately, so its address is not committed:

```bash
npx wrangler secret put EXTRA_APP_HOSTS
```

A callback naming a host in neither is refused, and only those origins may read
an answer back. Note that a hostname is not really a secret — a TLS certificate
puts it in the public transparency logs the day it is issued — so this keeps it
out of a public repository rather than out of reach. What protects a private
instance is that it requires signing in.

`SHORTCUT_NAME` must match the Shortcut installed on the device — the one that
takes text input and runs **Open URLs** on it. Copy to Clipboard is no longer
needed; the position comes back through the relay rather than the clipboard.

The deployed address is compiled into the app (`RELAY_URL` in
`src/lib/returnRelay.ts`); change it there if the Worker moves.

## The routes

- `GET /r/<token>?outcome=…&app=…` — where the player's callback lands. `app`
  is host **and path** (`lucaboox.github.io/nuvio-web/`), because a project
  site is installed from a subpath and `webapp://` opens only the address it
  was installed from; the host alone is what is checked against the list. With
  `position` and `duration` alongside if the player put them in the query
  rather than after the fragment. Stores what it has and returns a page that
  hands off to Shortcuts, which opens the app.
- `POST /p/<token>` — that page, sending the position it read out of the
  fragment. Same origin, so no CORS; the token is the permission, as elsewhere.
- `GET /c/<token>` — the app collecting its answer. CORS-restricted to the
  allowed hosts, and the slot is emptied on read.
