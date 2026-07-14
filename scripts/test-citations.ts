/**
 * Citation resolver tests. Pure functions, no network, no spend: `npx tsx scripts/test-citations.ts`.
 *
 * The cases that matter are not "does [src:1] become a link". They are the ones where a
 * naive rewriter corrupts the answer: a citation split across stream deltas, and an array
 * index in an n8n expression that looks exactly like a citation to a regex.
 */
import { createCitationResolver, type CitationSource } from "../lib/citations";

const SOURCES: CitationSource[] = [
  { title: "Merge node", docs_url: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.merge/" },
  { title: "Code node", docs_url: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/" },
  { title: "Webhook node", docs_url: "https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/" },
];

const MERGE = "[Merge node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.merge/)";
const CODE = "[Code node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/)";

let failed = 0;

/** Feed the text in chunks of `size` to prove the buffering, then flush. */
function run(input: string, size: number, sources = SOURCES) {
  const r = createCitationResolver(sources);
  let out = "";
  for (let i = 0; i < input.length; i += size) out += r.push(input.slice(i, i + size));
  out += r.flush();
  return { out, stats: r.stats };
}

function check(name: string, input: string, expected: string, sources = SOURCES) {
  // Every case runs at four chunk sizes. Size 1 is the adversarial one: it splits
  // "[src:1]" into seven deltas, which is exactly what a token stream does.
  for (const size of [1, 3, 7, 10_000]) {
    const { out } = run(input, size, sources);
    if (out !== expected) {
      failed++;
      console.error(`FAIL  ${name}  (chunk=${size})`);
      console.error(`  in       ${JSON.stringify(input)}`);
      console.error(`  expected ${JSON.stringify(expected)}`);
      console.error(`  actual   ${JSON.stringify(out)}`);
      return;
    }
  }
  console.log(`ok    ${name}`);
}

// --- resolution ---------------------------------------------------------------
check("single citation", "Use the Merge node [src:1].", `Use the Merge node ${MERGE}.`);
check("two indices in one marker", "Both [src:1,2] apply.", `Both ${MERGE} ${CODE} apply.`);
check("spaced marker", "See [src: 2 ].", `See ${CODE}.`);
check("repeated citations", "A [src:1] and B [src:1].", `A ${MERGE} and B ${MERGE}.`);

// --- the marker names a source that does not exist ----------------------------
// Dropped, not rendered. An index past the retrieved set is the model inventing a source,
// which is the whole failure this module exists to stop.
check("out-of-range index is dropped", "Fact [src:9] here.", "Fact  here.");
check("index 0 is dropped", "Fact [src:0] here.", "Fact  here.");

// --- CODE MUST SURVIVE UNTOUCHED ----------------------------------------------
// This is why the token is [src:N] and not [N]. Each of these is a real n8n expression.
check("array index in code", "Use `items[0].json.id` to read it.", "Use `items[0].json.id` to read it.");
check("all() index", "Write `$input.all()[1]` in the Code node.", "Write `$input.all()[1]` in the Code node.");
check("$items index", 'Use `$items("Set")[0].json`.', 'Use `$items("Set")[0].json`.');
check("json bracket access", 'Read `{{ $json["order id"] }}`.', 'Read `{{ $json["order id"] }}`.');
check(
  "fenced code block",
  "```js\nconst first = items[0];\nreturn [items[1]];\n```",
  "```js\nconst first = items[0];\nreturn [items[1]];\n```"
);

// --- URLs the model wrote itself ----------------------------------------------
check(
  "ungrounded docs link is un-linked, words kept",
  "See the [HTTP Request credentials](https://docs.n8n.io/integrations/builtin/credentials/httprequest/) page.",
  "See the HTTP Request credentials page."
);
check(
  "docs link to a RETRIEVED page is kept",
  "See [the merge docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.merge/).",
  "See [the merge docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.merge/)."
);
check(
  "anchor onto a retrieved page is canonicalised",
  "See [respond](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/#respond).",
  "See [respond](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)."
);
check(
  "bare ungrounded docs URL is removed",
  "Read https://docs.n8n.io/made/up/page/ for more.",
  "Read  for more."
);
check(
  "bare NON-n8n URL is snippet DATA and survives",
  "Set the URL to `https://api.example.com/v1/orders?page=2`.",
  "Set the URL to `https://api.example.com/v1/orders?page=2`."
);

// A markdown link is prose, never data. Policing only docs.n8n.io would leave an invented
// community/github link both un-stripped AND uncounted by the eval (which greps for
// "docs.n8n.io") — a hallucinated link that scores a perfect 1.000.
check(
  "invented markdown link on ANY host is un-linked",
  "See [the repo](https://github.com/n8n-io/n8n).",
  "See the repo."
);
check(
  "invented community link is un-linked",
  "See [this thread](https://community.n8n.io/t/12345).",
  "See this thread."
);
check(
  "bare invented n8n.io URL is removed",
  "Read https://community.n8n.io/t/12345 for more.",
  "Read  for more."
);

// --- truncation at MAX_OUTPUT_TOKENS -------------------------------------------
// The generation stops mid-marker. The fragment can never be completed, so it must not
// render as a literal "[src:" in the user's answer.
check("truncated mid-marker", "Check the Webhook docs [src:", "Check the Webhook docs ");
check("truncated mid-marker, partial index", "Check the docs [src:1", "Check the docs ");
check("truncated on a bare bracket", "An array [", "An array ");

// --- redirect mode has no sources: it can emit no links at all ------------------
check(
  "redirect cannot cite",
  "Ask me about n8n [src:1] https://docs.n8n.io/anything/",
  "Ask me about n8n  ",
  []
);

// --- prose that merely looks like a construct ----------------------------------
check("stray open bracket does not stall", "An unclosed [ bracket in prose.", "An unclosed [ bracket in prose.");
check("markdown list is untouched", "- [ ] todo item", "- [ ] todo item");

// --- stats --------------------------------------------------------------------
{
  const { stats } = run(
    "A [src:1] B [src:9] C [x](https://docs.n8n.io/nope/) D [y](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/)",
    5
  );
  const want = { resolved: 1, dropped: 1, stripped: 1, passed: 1 };
  const got = JSON.stringify(stats);
  if (got !== JSON.stringify(want)) {
    failed++;
    console.error(`FAIL  stats\n  expected ${JSON.stringify(want)}\n  actual   ${got}`);
  } else {
    console.log("ok    stats");
  }
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
