/**
 * Connection aliases. A connection's own label ("OpenCode · 100.82.76.122")
 * is accurate but hard to say; people recognise it by a name instead. When the
 * user has not chosen one, a stable name is derived from the connection id so
 * it does not change between launches.
 */

export type AliasStyle = "planets" | "animals";

export const ALIAS_STYLES: AliasStyle[] = ["planets", "animals"];

export const ALIAS_STYLE_LABELS: Record<AliasStyle, string> = {
  planets: "Planets",
  animals: "Animals",
};

const PLANETS = [
  "Mercury",
  "Venus",
  "Earth",
  "Mars",
  "Jupiter",
  "Saturn",
  "Uranus",
  "Neptune",
  "Pluto",
  "Ceres",
  "Eris",
  "Titan",
  "Europa",
  "Io",
  "Ganymede",
  "Callisto",
];

const ANIMALS = [
  "Fox",
  "Otter",
  "Heron",
  "Lynx",
  "Badger",
  "Koala",
  "Panda",
  "Raven",
  "Wolf",
  "Seal",
  "Ibis",
  "Moth",
  "Ferret",
  "Marten",
  "Gecko",
  "Crane",
];

function hash(value: string): number {
  let total = 0;
  for (let index = 0; index < value.length; index++) {
    total = (total * 31 + value.charCodeAt(index)) >>> 0;
  }
  return total;
}

export function aliasFor(connectionId: string, style: AliasStyle): string {
  const list = style === "animals" ? ANIMALS : PLANETS;
  return list[hash(connectionId) % list.length]!;
}
