/**
 * Word splitting for the "explode" selection mode: a message breaks into
 * tappable pieces so a phrase can be picked out without dragging selection
 * handles. Offsets are kept so a run of pieces copies the original slice.
 */

export interface BangToken {
  text: string;
  start: number;
  end: number;
}

const CJK = /[\u2E80-\u2EFF\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;
const PUNCTUATION = /[.,!?;:，。！？；：、"'“”‘’（）()\[\]【】{}<>《》…—–]/;

type WordSegmenter = {
  segment(input: string): Iterable<{ segment: string; index: number }>;
};

function cjkWords(run: string): Array<{ text: string; offset: number }> {
  const Segmenter = (
    Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: "word" }) => WordSegmenter }
  ).Segmenter;
  if (typeof Segmenter === "function") {
    try {
      const segmenter = new Segmenter("zh", { granularity: "word" });
      const parts: Array<{ text: string; offset: number }> = [];
      for (const part of segmenter.segment(run)) {
        if (!part.segment.trim()) continue;
        parts.push({ text: part.segment, offset: part.index });
      }
      if (parts.length > 0) return parts;
    } catch {
      // Fall through to the heuristic below.
    }
  }
  // No word dictionary available: Chinese words are usually two characters, so
  // pairing them reads far better than splitting every character.
  const parts: Array<{ text: string; offset: number }> = [];
  for (let index = 0; index < run.length; index += 2) {
    parts.push({ text: run.slice(index, index + 2), offset: index });
  }
  return parts;
}

export function splitBangTokens(text: string): BangToken[] {
  const tokens: BangToken[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (CJK.test(char)) {
      let stop = index + 1;
      while (stop < text.length && CJK.test(text[stop]!)) stop += 1;
      const run = text.slice(index, stop);
      for (const word of cjkWords(run)) {
        tokens.push({
          text: word.text,
          start: index + word.offset,
          end: index + word.offset + word.text.length,
        });
      }
      index = stop;
      continue;
    }
    if (PUNCTUATION.test(char)) {
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
