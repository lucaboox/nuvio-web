import assert from "node:assert/strict";
import test from "node:test";

import { platform } from "../src/platform/index.ts";
import {
  lifespan,
  loadPersonDetail,
  personSections,
  prefersCrew,
} from "../src/lib/person.ts";

const CONFIG = { enabled: true, apiKey: "key", language: "en-US" };

/**
 * Answers TMDB out of a routing table keyed by path fragment.
 *
 * `platform.request` is the whole of this module's contact with the network, so
 * replacing it is enough — and it is the same seam the desktop shell uses to
 * put these calls through Rust.
 */
function stubTmdb(routes) {
  const calls = [];
  platform.request = async (url) => {
    calls.push(url);
    const match = Object.keys(routes).find((key) => url.includes(key));
    if (!match) return { ok: false, status: 404, headers: {}, body: "{}" };
    const value = routes[match];
    if (value instanceof Error) throw value;
    return { ok: true, status: 200, headers: {}, body: JSON.stringify(value) };
  };
  return calls;
}

const credit = (id, over = {}) => ({
  id,
  title: `Film ${id}`,
  media_type: "movie",
  poster_path: `/p${id}.jpg`,
  release_date: "2015-06-01",
  popularity: 10,
  ...over,
});

test("a named role overrides what TMDB says someone is known for", () => {
  assert.equal(prefersCrew("Acting", "Director"), true);
  assert.equal(prefersCrew("Acting", "Creator"), true);
  assert.equal(prefersCrew("Acting", "Writer"), true);
  // A character name is a cast role, not a crew one.
  assert.equal(prefersCrew("Acting", "Ellen Ripley"), false);
});

test("without a role, the department decides", () => {
  assert.equal(prefersCrew("Acting"), false);
  assert.equal(prefersCrew("Directing"), true);
  assert.equal(prefersCrew("Writing"), true);
  assert.equal(prefersCrew(undefined), false);
});

test("credits become metas the ordinary poster cards can render", async () => {
  stubTmdb({
    "person/1/combined_credits": {
      cast: [credit(11), { ...credit(12), media_type: "tv", name: "Show", title: undefined, first_air_date: "2019-02-03" }],
    },
    "person/1": { id: 1, name: "Sigourney Weaver", known_for_department: "Acting" },
  });
  const person = await loadPersonDetail(1, CONFIG);
  assert.equal(person.name, "Sigourney Weaver");
  assert.equal(person.credits.length, 2);
  const [film, show] = person.credits;
  // The id an addon would use, so opening a credit takes the ordinary path.
  assert.equal(film.id, "tmdb:11");
  assert.equal(film.type, "movie");
  assert.equal(film.releaseInfo, "2015");
  assert.match(film.poster, /^https:\/\/image\.tmdb\.org\//);
  assert.equal(show.type, "series");
  assert.equal(show.name, "Show");
});

test("a person credited twice on one title appears once", async () => {
  stubTmdb({
    "person/2/combined_credits": {
      crew: [
        { ...credit(21), job: "Director", popularity: 5 },
        { ...credit(21), job: "Writer", popularity: 9 },
      ],
    },
    "person/2": { id: 2, name: "Jordan Peele", known_for_department: "Directing" },
  });
  const person = await loadPersonDetail(2, CONFIG);
  assert.equal(person.credits.length, 1);
  // The larger popularity survives, so a missing value on one row cannot
  // demote a title that the other row ranked.
  assert.equal(person.popularity["tmdb:21"], 9);
});

test("a director's crew credits win over a walk-on part", async () => {
  stubTmdb({
    "person/3/combined_credits": {
      cast: [credit(31, { title: "Cameo" })],
      crew: [credit(32, { title: "Directed", job: "Director" })],
    },
    "person/3": { id: 3, name: "Ridley Scott", known_for_department: "Directing" },
  });
  const person = await loadPersonDetail(3, CONFIG);
  assert.deepEqual(
    person.credits.map((item) => item.name),
    ["Directed"],
  );
});

test("an empty preferred bucket falls back rather than showing nothing", async () => {
  stubTmdb({
    "person/4/combined_credits": { cast: [credit(41)], crew: [] },
    "person/4": { id: 4, name: "Someone", known_for_department: "Directing" },
  });
  const person = await loadPersonDetail(4, CONFIG);
  assert.equal(person.credits.length, 1);
});

test("a missing biography is asked for again in English", async () => {
  const calls = stubTmdb({
    "person/5/combined_credits": { cast: [] },
    "person/5": { id: 5, name: "Someone", biography: "" },
  });
  const person = await loadPersonDetail(5, { ...CONFIG, language: "de-DE" });
  // TMDB returns an empty string rather than falling back, so asking once in
  // the configured language silently costs the whole biography.
  assert.ok(calls.some((url) => url.includes("language=en")));
  assert.equal(person.biography, undefined);
});

test("an English configuration does not ask twice", async () => {
  const calls = stubTmdb({
    "person/6/combined_credits": { cast: [] },
    "person/6": { id: 6, name: "Someone", biography: "" },
  });
  await loadPersonDetail(6, CONFIG);
  assert.equal(calls.filter((url) => url.includes("person/6?")).length, 1);
});

test("credits failing does not lose the person", async () => {
  stubTmdb({
    "person/7/combined_credits": new Error("TMDB is down"),
    "person/7": { id: 7, name: "Someone", biography: "A life." },
  });
  const person = await loadPersonDetail(7, CONFIG);
  assert.equal(person.name, "Someone");
  assert.equal(person.biography, "A life.");
  assert.deepEqual(person.credits, []);
});

test("the person failing is an error, not an empty page", async () => {
  stubTmdb({ "person/8/combined_credits": { cast: [] } });
  await assert.rejects(() => loadPersonDetail(8, CONFIG));
});

test("browsing a person needs TMDB configured", async () => {
  await assert.rejects(
    () => loadPersonDetail(9, { ...CONFIG, apiKey: "  " }),
    /TMDB/,
  );
  await assert.rejects(() => loadPersonDetail(9, { ...CONFIG, enabled: false }));
});

test("credits group into popular, latest and upcoming", () => {
  const meta = (id, released) => ({ id, type: "movie", name: id, released });
  const today = new Date().toISOString().slice(0, 10);
  const future = `${new Date().getFullYear() + 3}-01-01`;
  const person = {
    tmdbId: 1,
    name: "Someone",
    credits: [
      meta("a", "2001-01-01"),
      meta("b", "2020-01-01"),
      meta("c", future),
    ],
    popularity: { a: 99, b: 1, c: 50 },
  };
  const sections = personSections(person);
  assert.deepEqual(
    sections.map((section) => section.name),
    ["Popular", "Latest", "Upcoming"],
  );
  const [popular, latest, upcoming] = sections;
  // Popular carries everything, ranked; Latest is what has come out, newest
  // first; Upcoming is what has not, soonest first.
  assert.deepEqual(popular.items.map((item) => item.id), ["a", "c", "b"]);
  assert.deepEqual(latest.items.map((item) => item.id), ["b", "a"]);
  assert.deepEqual(upcoming.items.map((item) => item.id), ["c"]);
  assert.ok(today <= future);
});

test("an empty group is dropped rather than shown empty", () => {
  const person = {
    tmdbId: 1,
    name: "Someone",
    credits: [{ id: "a", type: "movie", name: "a", released: "2001-01-01" }],
    popularity: {},
  };
  assert.deepEqual(
    personSections(person).map((section) => section.name),
    ["Popular", "Latest"],
  );
  assert.deepEqual(personSections({ ...person, credits: [] }), []);
});

test("a credit with no date is still popular, just not dated", () => {
  const person = {
    tmdbId: 1,
    name: "Someone",
    credits: [{ id: "a", type: "movie", name: "a" }],
    popularity: { a: 3 },
  };
  const sections = personSections(person);
  assert.deepEqual(sections.map((section) => section.name), ["Popular"]);
});

test("a lifespan reads as one range, or as nothing", () => {
  assert.match(lifespan({ birthday: "1949-10-08" }), /1949/);
  const both = lifespan({ birthday: "1949-10-08", deathday: "2024-01-02" });
  assert.match(both, /1949.+–.+2024/);
  assert.equal(lifespan({}), "");
});
