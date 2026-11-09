/**
 * Word splitting for the "explode" selection mode: a message breaks into
 * tappable pieces so a phrase can be picked out without dragging selection
 * handles. Offsets are kept so a run of pieces copies the original slice.
 *
 * Chinese has no word boundaries on the device (Hermes has no
 * Intl.Segmenter), and guessing at word pairs was worse than honest
 * characters — a drag across several pieces selects a phrase anyway.
 */

export interface BangToken {
  text: string;
  start: number;
  end: number;
}

const CJK = /[\u2E80-\u2EFF\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
const PUNCTUATION = /[.,!?;:，。！？；：、"'“”‘’（）()\[\]【】{}<>《》…—–]/;

export function splitBangTokens(text: string): BangToken[] {
  const tokens: BangToken[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (CJK.test(char) || PUNCTUATION.test(char)) {
      tokens.push({ text: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    let stop = index + 1;
    while (stop < text.length) {
      const next = text[stop]!;
      if (/\s/.test(next) || CJK.test(next) || PUNCTUATION.test(next)) break;
      stop += 1;
    }
    tokens.push({ text: text.slice(index, stop), start: index, end: stop });
    index = stop;
  }

  return tokens;
}

/** The original text covered by the selected tokens. */
export function selectedSlice(text: string, tokens: BangToken[], selected: Set<number>): string {
  if (selected.size === 0) return text;
  const indexes = [...selected].sort((a, b) => a - b);
  const first = tokens[indexes[0]!];
  const last = tokens[indexes[indexes.length - 1]!];
  if (!first || !last) return text;
  return text.slice(first.start, last.end);
}

/** Every token between two indexes, inclusive, in either direction. */
export function tokenRange(from: number, to: number): Set<number> {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const set = new Set<number>();
  for (let index = start; index <= end; index++) set.add(index);
  return set;
}
