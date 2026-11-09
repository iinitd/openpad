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

function hash(value: string): number {
  let total = 0;
  for (let index = 0; index < value.length; index++) {
    total = (total * 31 + value.charCodeAt(index)) >>> 0;
  }
  return total;
}

/** A stable name for a connection that has none of its own. */
export function aliasFor(connectionId: string): string {
  return NAMES[hash(connectionId) % NAMES.length]!;
}

/** A fresh name, never the one already showing. */
export function randomAlias(current?: string): string {
  if (NAMES.length === 1) return NAMES[0]!;
  let next = current;
  while (next === current) {
    next = NAMES[Math.floor(Math.random() * NAMES.length)];
  }
  return next!;
}
