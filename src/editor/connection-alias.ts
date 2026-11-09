/**
 * Connection names. A connection's own label ("OpenCode · 100.82.76.122") is
 * accurate but hard to say; people recognise it by a short name instead. Names
 * come from a pool of onomatopoeia — short, distinct and easy to spot.
 */

const NAMES = [
  "Bloop",
  "Clank",
  "Whirr",
  "Thunk",
  "Sizzle",
  "Boing",
  "Zap",
  "Fizz",
  "Rumble",
  "Crackle",
  "Whoosh",
  "Plink",
  "Klang",
  "Thump",
  "Buzz",
  "Hiss",
  "Rattle",
  "Clatter",
  "Splash",
  "Squelch",
  "Beep",
  "Chime",
  "Clunk",
  "Ding",
  "Fwoosh",
  "Glug",
  "Honk",
  "Jingle",
  "Knock",
  "Murmur",
  "Ping",
  "Pop",
  "Purr",
  "Ratchet",
  "Screech",
  "Shuffle",
  "Snip",
  "Swish",
  "Tick",
  "Twang",
  "Vroom",
  "Wobble",
  "Zoom",
];

/**
 * A fresh name the user does not already have: never the current one, and
 * never one another connection is using. Falls back to the whole pool only
 * when every name is taken.
 */
export function randomAlias(current?: string, taken: string[] = []): string {
  const blocked = new Set(
    taken.filter(Boolean).map((name) => name.trim().toLowerCase()),
  );
  if (current) blocked.add(current.trim().toLowerCase());
  const pool = NAMES.filter((name) => !blocked.has(name.toLowerCase()));
  const source = pool.length > 0 ? pool : NAMES;
  return source[Math.floor(Math.random() * source.length)]!;
}
