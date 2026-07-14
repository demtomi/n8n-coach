/**
 * Citations the model cannot invent.
 *
 * THE DEFECT THIS CLOSES. The model used to write its own markdown links
 * (`[Merge node](https://docs.n8n.io/...)`). Measured on the first honest endpoint run
 * (build `0adb25f`), 8 of 44 emitted docs.n8n.io links were not in the corpus. Every one
 * of them happened to RESOLVE — n8n's docs URL scheme is regular enough that Sonnet can
 * usually guess a live path from parametric memory — so the app was not handing anyone a
 * 404. It was doing something subtler and worse: emitting URLs it had never read, in an
 * app whose entire rule is "answer using ONLY the retrieved documentation". Four of those
 * eight were real pages we simply had not retrieved; the other four were `#anchor` deep
 * links onto pages we HAD retrieved (the eval's exact-match scorer counted those invalid,
 * which understated the app). Nothing guaranteed the next guess would land.
 *
 * So the model no longer writes URLs at all. It cites `[src:N]`, naming the index of a
 * <source> it was actually given, and this module resolves N to that source's real
 * `docs_url` server-side. A link in the output is now, by construction, the URL of a
 * document that retrieval put in front of the model for THIS query.
 *
 * WHY `[src:N]` AND NOT `[N]`. A bare `[1]` collides with code. These answers are full of
 * `items[0].json`, `$input.all()[0]`, `$items("Node")[1]` — rewriting brackets blind would
 * turn working n8n expressions into garbage, and dropping an "out of range" `[0]` would
 * silently delete an array index from a snippet the user is about to paste into a Code
 * node. `[src:N]` cannot occur in n8n code or JavaScript, so the rewriter never has to
 * guess whether a bracket is prose or program.
 *
 * DEFENCE IN DEPTH. Instructions are not a mechanism, so the resolver also polices any URL
 * that survives the instruction:
 *   - a docs.n8n.io link to a page we DID retrieve  → kept, canonicalised to that docs_url
 *   - a docs.n8n.io link to anything else           → the URL is dropped, the words remain
 *   - any other host (api.example.com in a snippet) → untouched, it is example data
 * The allow-list is the retrieved set, not the whole 332-doc corpus: a corpus URL we did
 * not retrieve is still a URL the model did not read.
 */

import type { StreamTextTransform, TextStreamPart, ToolSet } from "ai";

export type CitationSource = {
  title: string;
  docs_url: string;
};

/** Appended to both BASE_SYSTEM and DEBUG_SYSTEM. */
export const CITATION_RULE = `- Cite sources by index, never by URL. Each retrieved document is tagged <source index="N">. To cite it, write [src:N] immediately after the claim it supports — for example: Use the Merge node in "Combine" mode [src:2].
- NEVER write a URL, a link, or a domain name of your own. Do not write https://docs.n8n.io/... . The [src:N] markers are replaced with real documentation links after you finish; any URL you type yourself is discarded, and the sentence around it is kept.
- Cite only indices that exist in the retrieved sources below. If nothing supports a claim, do not cite anything for it.`;

const MAX_HOLD = 512;

/** A partial `[src:` marker left dangling by a truncated generation. */
const PARTIAL_MARKER_RE = /\[(?:s(?:r(?:c(?::[\d\s,]*)?)?)?)?$/;

/**
 * ONE scan, three constructs. Alternation in a single pass is not a micro-optimisation:
 * chaining three `.replace()` calls would feed each stage the OUTPUT of the last, so the
 * `[Merge node](url)` this module generates from `[src:1]` would then be re-matched as a
 * model-written link and audited a second time. One pass over the original text means
 * every construct is classified exactly once, and generated links are never re-examined.
 *
 *   1 — [src:2] · [src: 2] · [src:1,3]     the citation marker
 *   2,3 — [text](url)                       a markdown link the model wrote anyway
 *   4 — https://…                           a bare URL the model wrote anyway
 *
 * The link label excludes `[` as well as `]`, so an unclosed bracket earlier on the line
 * ("an array [see [Merge](url)") cannot make the label swallow it.
 */
const SCAN_RE =
  /\[src:\s*(\d+(?:\s*,\s*\d+)*)\s*\]|\[([^[\]\n]*)\]\(\s*([^)\s\n]*)\s*\)|(https?:\/\/[^\s<>"'`)\]]+)/gi;

/**
 * WHICH LINKS ARE OURS TO POLICE. Two different rules, because the two constructs carry
 * different intent.
 *
 * A MARKDOWN LINK is always a citation — prose furniture, never data. The model has no
 * business emitting one on any host (it is shown no URLs at all now), so every markdown
 * link is checked and only a retrieved docs page survives. Policing docs.n8n.io alone
 * would have left an invented `[thread](https://community.n8n.io/t/12345)` untouched AND
 * uncounted, since the eval scorer only looks for `docs.n8n.io` — a hallucinated link that
 * reads as a perfect 1.000.
 *
 * A BARE URL may well be DATA: the coach routinely writes `https://api.example.com/orders`
 * into an HTTP Request node config, and deleting that would corrupt the answer. So a bare
 * URL is only policed when its host is n8n's own — those can only ever be a citation, never
 * a sample endpoint. Everything else is left exactly as written.
 */
function isN8nHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "n8n.io" || h.endsWith(".n8n.io");
  } catch {
    return false;
  }
}

/**
 * The tail of a buffer that might still be growing into one of those constructs. Emitting
 * it now would mean rewriting half a citation — or, worse, stripping a URL out of a link
 * whose closing `)` has not arrived yet and leaving the empty `[text]()` shell behind.
 *
 * So: hold from the last `[` unless what follows it is DEFINITIVELY finished. Both
 * constructs are single-line, so a newline inside an unclosed bracket proves it is neither
 * and releases it; `MAX_HOLD` is the backstop against anything else. Without this the
 * stream could stall on a stray `[` in prose.
 */
function holdFrom(buf: string): number {
  let hold = buf.length;
  const take = (i: number) => {
    if (i >= 0 && i < hold) hold = i;
  };

  const lb = buf.lastIndexOf("[");
  if (lb !== -1) {
    const rest = buf.slice(lb);
    const complete =
      /^\[[^\]\n]*\]\([^)\n]*\)/.test(rest) || // a finished [text](url)
      /^\[[^\]\n]*\][^(]/.test(rest); // a closed [..] with a next char that is not "("
    // A bracket closed at the very END of the buffer is NOT complete: the next delta could
    // be "(", turning `[Merge node]` into a link. Hold it one more character.
    if (!complete && !rest.includes("\n") && rest.length <= MAX_HOLD) take(lb);
  }

  // A URL still arriving, or its scheme half-typed at the very end.
  const url = /https?:\/\/[^\s<>"'`)\]]*$/.exec(buf);
  if (url) take(url.index);
  const scheme = /(?:h|ht|htt|http|https|http:|https:|http:\/|https:\/)$/.exec(buf);
  if (scheme) take(scheme.index);

  if (buf.length - hold > MAX_HOLD) return buf.length;
  return hold;
}

function canonical(url: string): string {
  // Trailing sentence punctuation is not part of the URL; neither is a #fragment or a
  // ?query for the purpose of asking "is this the page we retrieved?".
  const cleaned = url.replace(/[).,;:!?'"]+$/, "");
  return cleaned.split("#")[0].split("?")[0];
}

// A title goes inside [ ] — brackets in it would break the markdown link it lands in.
function linkText(title: string): string {
  return title.replace(/[[\]]/g, "").trim() || "n8n docs";
}

export type CitationStats = {
  /** [src:N] markers resolved to a real link. */
  resolved: number;
  /** [src:N] markers naming a source that was not retrieved — dropped. */
  dropped: number;
  /** docs.n8n.io URLs the model wrote itself that we un-linked (ungrounded). */
  stripped: number;
  /** docs.n8n.io URLs the model wrote itself that happened to be a retrieved page — kept. */
  passed: number;
};

export function createCitationResolver(sources: CitationSource[]) {
  const byIndex = new Map<number, CitationSource>();
  const allowed = new Set<string>();
  sources.forEach((s, i) => {
    byIndex.set(i + 1, s);
    allowed.add(canonical(s.docs_url));
  });

  const stats: CitationStats = { resolved: 0, dropped: 0, stripped: 0, passed: 0 };

  /**
   * Rewrite a segment that is known to be COMPLETE — the streaming caller only ever hands
   * this text it will not append to. Order matters: markdown links are resolved before
   * bare URLs, so the URL inside a link is never also treated as a loose URL.
   */
  function rewrite(segment: string): string {
    return segment.replace(
      SCAN_RE,
      (
        match: string,
        indices: string | undefined,
        linkLabel: string | undefined,
        linkUrl: string | undefined,
        bareUrl: string | undefined
      ) => {
        // 1. The citation marker: resolve each index to a source we actually retrieved.
        if (indices !== undefined) {
          const parts = indices.split(",");
          const links = parts
            .map((n) => byIndex.get(Number(n.trim())))
            .filter((s): s is CitationSource => Boolean(s))
            .map((s) => `[${linkText(s.title)}](${canonical(s.docs_url)})`);
          stats.resolved += links.length;
          stats.dropped += parts.length - links.length;
          // An index naming a source that does not exist is the model inventing one. The
          // marker goes; the sentence it sat in stays.
          return links.join(" ");
        }

        // 2. A markdown link the model wrote in defiance of the prompt. EVERY host is
        //    checked: a link is prose, never data, so nothing it can point at is legitimate
        //    except a page we retrieved.
        if (linkUrl !== undefined) {
          const c = canonical(linkUrl);
          if (allowed.has(c)) {
            stats.passed++;
            return `[${linkLabel}](${c})`;
          }
          stats.stripped++;
          return linkLabel ?? ""; // keep the words, lose the ungrounded link
        }

        // 3. A bare URL. Only n8n's own hosts are policed — a bare api.example.com is
        //    sample data inside an HTTP Request config and deleting it would corrupt the
        //    answer, but a bare n8n.io URL can only ever have been a citation.
        if (bareUrl !== undefined) {
          if (!isN8nHost(bareUrl)) return match;
          const c = canonical(bareUrl);
          if (allowed.has(c)) {
            stats.passed++;
            return c;
          }
          stats.stripped++;
          return "";
        }

        return match;
      }
    );
  }

  let buf = "";

  return {
    stats,

    /** Feed raw model text; get back the text that is safe to emit now. */
    push(chunk: string): string {
      buf += chunk;
      const hold = holdFrom(buf);
      if (hold === 0) return "";
      const safe = buf.slice(0, hold);
      buf = buf.slice(hold);
      return rewrite(safe);
    },

    /**
     * End of a text block: nothing more is coming, so the held tail is final.
     *
     * A generation cut off at MAX_OUTPUT_TOKENS can end mid-marker ("...the Webhook docs
     * [src:"). That fragment will never be completed, and SCAN_RE cannot match it, so
     * without this it would render as a literal `[src:` — the internal protocol leaking
     * into the user's answer on exactly the long-workflow case most likely to truncate.
     */
    flush(): string {
      const rest = buf.replace(PARTIAL_MARKER_RE, "");
      buf = "";
      return rest ? rewrite(rest) : "";
    },
  };
}

/**
 * The resolver as a streamText transform.
 *
 * It runs BEFORE smoothStream: this one buffers (it must, to see a whole `[src:2]` that
 * arrived as `[src` + `:2]`), and smoothStream then re-chunks whatever comes out into the
 * word-by-word cadence the UI expects. Reversing the order would let this stage's ragged
 * re-emission show through as stutter.
 *
 * `text-end` is the flush point, not the stream end: a step can contain more than one text
 * block, and a tail held past the end of its own block would be emitted into the next one.
 */
export function citationTransform<TOOLS extends ToolSet>(
  resolver: CitationResolver
): StreamTextTransform<TOOLS> {
  type Part = TextStreamPart<TOOLS>;

  return () =>
    new TransformStream<Part, Part>({
      transform(part, controller) {
        if (part.type === "text-delta") {
          const text = resolver.push(part.text);
          // A delta swallowed whole into the buffer emits nothing — a text-delta carrying
          // an empty string is noise on the wire, so it is skipped rather than sent.
          if (text) controller.enqueue({ ...part, text });
          return;
        }
        if (part.type === "text-end") {
          const text = resolver.flush();
          if (text) {
            controller.enqueue({
              type: "text-delta",
              id: part.id,
              text,
            } as Part);
          }
        }
        controller.enqueue(part);
      },
    });
}

export type CitationResolver = ReturnType<typeof createCitationResolver>;
