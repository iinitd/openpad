/**
 * Small syntax highlighter for the file preview. A full tokenizer library is
 * more than this surface needs — the document shell only draws HTML, so a
 * single pass that wraps comments, strings, numbers and keywords is enough to
 * make source readable.
 */

type Language = {
  keywords: Set<string>;
  literals: Set<string>;
  lineComments: string[];
  blockComment?: [string, string];
  quotes: string[];
  caseInsensitive?: boolean;
};

const words = (value: string) => new Set(value.split(/\s+/).filter(Boolean));

const JS_KEYWORDS = words(
  "await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async as",
);
const JS_LITERALS = words("true false null undefined NaN Infinity this");
const TS_EXTRA = words(
  "type interface enum implements namespace declare readonly abstract satisfies infer keyof unknown never any string number boolean object",
);
const TS_LITERALS = words("true false null undefined this");

const LANGUAGES: Record<string, Language> = {
  javascript: {
    keywords: JS_KEYWORDS,
    literals: JS_LITERALS,
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ["'", '"', "`"],
  },
  typescript: {
    keywords: new Set([...JS_KEYWORDS, ...TS_EXTRA]),
    literals: TS_LITERALS,
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ["'", '"', "`"],
  },
  json: {
    keywords: words(""),
    literals: words("true false null"),
    lineComments: [],
    quotes: ['"'],
  },
  jsonc: {
    keywords: words(""),
    literals: words("true false null"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"'],
  },
  python: {
    keywords: words(
      "def class return if elif else for while in not and or is import from as with try except finally raise lambda pass break continue global nonlocal yield assert del async await match case",
    ),
    literals: words("True False None self"),
    lineComments: ["#"],
    quotes: ["'", '"'],
  },
  shell: {
    keywords: words(
      "if then else elif fi for while until do done case esac in function export local return echo cd source set unset",
    ),
    literals: words(""),
    lineComments: ["#"],
    quotes: ["'", '"'],
  },
  go: {
    keywords: words(
      "package import func var const type struct interface map chan go defer return if else for range switch case default break continue select fallthrough",
    ),
    literals: words("true false nil iota"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ["'", '"', "`"],
  },
  rust: {
    keywords: words(
      "fn let mut const struct enum trait impl pub use mod match if else for while loop return break continue move ref where async await dyn unsafe crate self super",
    ),
    literals: words("true false None Some Ok Err"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ["'", '"'],
  },
  java: {
    keywords: words(
      "public private protected class interface extends implements new return if else for while do switch case default break continue static final void int long double float boolean char byte short import package try catch finally throw throws this super",
    ),
    literals: words("true false null"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ["'", '"'],
  },
  c: {
    keywords: words(
      "int long short char float double void unsigned signed const static struct union enum typedef return if else for while do switch case default break continue sizeof goto extern",
    ),
    literals: words("NULL true false"),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ["'", '"'],
  },
  css: {
    keywords: words(""),
    literals: words(""),
    lineComments: [],
    blockComment: ["/*", "*/"],
    quotes: ["'", '"'],
  },
  yaml: {
    keywords: words(""),
    literals: words("true false null yes no on off"),
    lineComments: ["#"],
    quotes: ["'", '"'],
  },
  toml: {
    keywords: words(""),
    literals: words("true false"),
    lineComments: ["#"],
    quotes: ["'", '"'],
  },
  sql: {
    keywords: words(
      "select from where insert into values update set delete create table index view join left right inner outer on group by order having limit offset as and or not null primary key foreign references default distinct union all case when then else end",
    ),
    literals: words("true false null"),
    lineComments: ["--"],
    blockComment: ["/*", "*/"],
    quotes: ["'", '"'],
    caseInsensitive: true,
  },
  xml: {
    keywords: words(""),
    literals: words(""),
    lineComments: [],
    blockComment: ["<!--", "-->"],
    quotes: ['"', "'"],
  },
  plain: {
    keywords: words(""),
    literals: words(""),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ["'", '"'],
  },
};

const EXT_LANGUAGE: Record<string, string> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".json": "json",
  ".jsonc": "jsonc",
  ".json5": "jsonc",
  ".py": "python",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "shell",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "java",
  ".swift": "java",
  ".cs": "java",
  ".c": "c",
  ".h": "c",
  ".cc": "c",
  ".cpp": "c",
  ".hpp": "c",
  ".css": "css",
  ".scss": "css",
  ".less": "css",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".ini": "toml",
  ".conf": "toml",
  ".env": "toml",
  ".sql": "sql",
  ".xml": "xml",
  ".html": "xml",
  ".htm": "xml",
};

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function span(kind: string, value: string): string {
  return `<span class="tok-${kind}">${escape(value)}</span>`;
}

export function highlightCode(source: string, ext: string): string {
  const language = LANGUAGES[EXT_LANGUAGE[ext] ?? "plain"] ?? LANGUAGES.plain!;
  const normalize = (value: string) =>
    language.caseInsensitive ? value.toLowerCase() : value;
  const keywords = new Set(
    [...language.keywords].map((word) => normalize(word)),
  );
  const literals = new Set(
    [...language.literals].map((word) => normalize(word)),
  );

  let output = "";
  let index = 0;

  const matchesAt = (value: string, at: number) =>
    source.startsWith(value, at);

  while (index < source.length) {
    const char = source[index]!;

    const block = language.blockComment;
    if (block && matchesAt(block[0], index)) {
      const end = source.indexOf(block[1], index + block[0].length);
      const stop = end === -1 ? source.length : end + block[1].length;
      output += span("comment", source.slice(index, stop));
      index = stop;
      continue;
    }

    const lineComment = language.lineComments.find((token) =>
      matchesAt(token, index),
    );
    if (lineComment) {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      output += span("comment", source.slice(index, stop));
      index = stop;
      continue;
    }

    if (language.quotes.includes(char)) {
      let stop = index + 1;
      while (stop < source.length) {
        if (source[stop] === "\\") {
          stop += 2;
          continue;
        }
        if (source[stop] === char) {
          stop += 1;
          break;
        }
        stop += 1;
      }
      output += span("string", source.slice(index, stop));
      index = stop;
      continue;
    }

    if (/[0-9]/.test(char) && !/[A-Za-z_$]/.test(source[index - 1] ?? "")) {
      let stop = index + 1;
      while (stop < source.length && /[0-9a-fA-FxX._eE+-]/.test(source[stop]!)) {
        stop += 1;
      }
      output += span("number", source.slice(index, stop));
      index = stop;
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      let stop = index + 1;
      while (stop < source.length && /[A-Za-z0-9_$]/.test(source[stop]!)) {
        stop += 1;
      }
      const word = source.slice(index, stop);
      const key = normalize(word);
      if (keywords.has(key)) output += span("keyword", word);
      else if (literals.has(key)) output += span("literal", word);
      else output += escape(word);
      index = stop;
      continue;
    }

    output += escape(char);
    index += 1;
  }

  return output;
}
