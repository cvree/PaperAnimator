# 07 — AI Services

Everything that talks to a model lives in `packages/ai`. One package, one client, one
place where the provenance rules are enforced. No other package may import the SDK.

> **Reference date for API facts in this document: 2026-08-16.** Model IDs, pricing, and
> beta headers change; re-verify against the Anthropic docs before a major release.

---

## 1. Model selection

| Job | Model | Why |
|---|---|---|
| Comprehension (question/method/findings/limitations) | `claude-opus-5` | Accuracy-critical. This is the call that decides what the paper *says*. |
| Narration & explanation generation | `claude-opus-5` | The output is user-facing prose that must not overstate the source. |
| Figure alt text | `claude-opus-5` | Vision + caption + mention context; a wrong alt text is an accessibility failure |
| Section-kind classification | `claude-haiku-4-5` | High volume, low stakes, cheap |
| Reference-entry parsing (grammar fallback) | `claude-haiku-4-5` | Structured, mechanical |
| Statistic + hedge classification | `claude-haiku-4-5` | Bounded schema, verified by regex first |

**Pricing (per million tokens, first-party API):**

| Model | Input | Output |
|---|---|---|
| `claude-opus-5` | $5.00 | $25.00 |
| `claude-sonnet-5` | $3.00 | $15.00 |
| `claude-haiku-4-5` | $1.00 | $5.00 |

We do **not** downgrade the accuracy path to save money. The whole product proposition is
that the output is trustworthy; spending $0.40 less per project to make it less so is a
bad trade. Cost is controlled through caching and batching (§4, §5), not through model
substitution on the paths that matter.

**Thinking and effort.** Thinking is on by default on `claude-opus-5`; we set it
explicitly for clarity and pick effort per job:

```ts
// comprehension — hardest reasoning in the product
{ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }

// per-scene narration — bounded, well-specified
{ thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } }

// classification on haiku — no thinking config; the model doesn't take one
```

`max_tokens` is sized generously (16000 non-streaming, 64000 streaming) because thinking
and response share that budget — an under-sized `max_tokens` truncates mid-answer.

---

## 2. Provenance comes from citations

This is the most important decision in the document.

Claude's document citations return, for every cited claim, the `cited_text` and a
`page_location` with `start_page_number` / `end_page_number`. That gives us claim → page
grounding **from the model itself**, rather than from post-hoc string matching that we'd
have to write, tune, and apologize for.

```ts
const res = await client.messages.create({
  model: 'claude-opus-5',
  max_tokens: 16000,
  system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral', ttl: '1h' } }],
  messages: [{
    role: 'user',
    content: [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
        title: paper.meta.title ?? 'Paper',
        citations: { enabled: true },          // ← the provenance backbone
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
      { type: 'text', text: task },
    ],
  }],
});
```

Response text arrives split into blocks; cited blocks carry a `citations` array:

```ts
for (const block of res.content) {
  if (block.type !== 'text') continue;
  for (const c of block.citations ?? []) {
    if (c.type === 'page_location') {
      refs.push({
        page: c.start_page_number,          // 1-indexed, matches our Page.number
        text: c.cited_text,
        quads: resolveQuads(c.start_page_number, c.cited_text),  // §2.1
      });
    }
  }
}
```

**Uncited factual text is not trusted.** A text block with no `citations` array is
classified `connective` and is only allowed to be a transition. If it contains a number,
a comparative, or a causal verb, it is demoted to `unsupported/no-source` and surfaces in
the integrity view.

### 2.1 `cited_text` → quads

Citations give us the page and the text; the highlight needs rectangles. `resolveQuads`
matches `cited_text` against the pdf.js text items for that page:

1. Normalize both sides (collapse whitespace, unify quotes/dashes, strip soft hyphens).
2. Find the token span with the best alignment score across the page's items.
3. Emit one `Quad` per line fragment in the matched span.
4. If the best score is below 0.85, **keep the page-level ref and return no quads**, with
   `confidence` reduced.

A page-level reference that says "page 7" is honest. A rectangle drawn around the wrong
sentence is worse than no rectangle, so we never guess one.

### 2.2 The structured-output constraint

**Citations and `output_config.format` are mutually exclusive** — sending both returns a
400. This shapes the architecture:

| Call needs | Approach |
|---|---|
| Citations **and** structure | **Strict tool use**: define a tool with `strict: true` and a forced `tool_choice`; the model calls it once with validated arguments, and the accompanying text blocks carry the citations |
| Structure, no citations needed | `output_config.format` with `zodOutputFormat(schema)` — simplest, fully validated |
| Citations, free-form text | Plain text blocks, parsed for citations |

Comprehension and narration both need citations *and* structure, so both use the strict-
tool pattern:

```ts
import { z } from 'zod';

const Finding = z.object({
  statement: z.string(),
  hedge: z.enum(['assertion','association','suggestion','speculation','negative','null-result']),
  statRaw: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const res = await client.messages.create({
  model: 'claude-opus-5',
  max_tokens: 16000,
  tools: [{
    name: 'record_comprehension',
    description: 'Record the paper\'s question, method, findings, limitations and conclusions.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        question:    { type: ['string','null'] },
        method:      { type: ['string','null'] },
        findings:    { type: 'array', items: findingSchema },
        limitations: { type: 'array', items: findingSchema },
        conclusions: { type: 'array', items: findingSchema },
      },
      required: ['question','method','findings','limitations','conclusions'],
      additionalProperties: false,
    },
  }],
  tool_choice: { type: 'tool', name: 'record_comprehension' },
  messages: [/* cached document + task */],
});
```

`strict: true` guarantees the arguments validate against the schema, so there is no
defensive parsing on our side.

---

## 3. Prompt design rules

The system prompt for every grounded call carries these constraints. They are short and
plain, because current models follow clear instructions closely and over-emphasis causes
over-triggering:

```
You are working from one research paper. Everything you write is checked against it.

Ground every factual sentence in the document. If you cannot ground a sentence, do not
write it — omit the point rather than filling the gap.

Preserve the strength of every claim exactly as the paper states it. If the paper says
"was associated with", do not write "caused" or "reduced". If the paper reports a null
result, report it as a null result.

Keep numbers exactly as printed, with their units and qualifiers. A percentage without
its confidence interval, or a mean without its sample size, is a changed claim.

If the paper does not state something — limitations, a mechanism, a comparison — say
that it does not state it. Never supply the missing piece from general knowledge.

Uncertainty is information. Report it rather than smoothing it away.
```

Notes on what is deliberately **absent**:

- No `CRITICAL:` / `YOU MUST` emphasis. Current models over-apply it, and a prompt where
  everything is critical has no priorities.
- No step-by-step choreography. The constraint is stated; the method is the model's.
- No "be accurate and helpful" filler. It restates a trained default and costs tokens on
  every cached read.
- No output-format prose. The schema does that job, verifiably.

**Audience is a real parameter,** not a tone adjective — it changes what is explained:

| Audience | Behaviour |
|---|---|
| `expert` | Uses field terminology; explains only the novel contribution |
| `informed` | Defines domain-specific terms on first use; assumes scientific literacy |
| `general` | Explains method and statistics in plain language; still preserves hedging |

Hedging is preserved at **every** audience level. "Simplify" never means "assert".

---

## 4. Prompt caching — architectural, not an optimization

The extracted paper is a large, stable prefix reused across 20–50 calls per project (one
per scene for narration, plus verification and alt-text calls). Getting the ordering
wrong makes the product roughly 5–10× more expensive, silently.

**Render order is `tools` → `system` → `messages`.** Layout:

```
[tools]              ← deterministic, sorted by name. Never varies per call.
[system]             ← frozen. No dates, no user names, no scene counts.
[document + PDF]     ← cache_control: { type: 'ephemeral', ttl: '1h' }   ← BREAKPOINT
[task instruction]   ← varies per call. Everything volatile lives here.
```

Rules we enforce in code:

1. `system` is a module-level constant. Interpolating anything into it is a lint error
   (`no-template-literal` on the system prompt export).
2. Tools are sorted by name before every request.
3. Nothing time-based, random, or user-identifying appears before the breakpoint.
4. `ttl: '1h'` because a project's calls span a work session, not five minutes. The 2×
   write premium pays back after three reads; we make dozens.
5. Minimum cacheable prefix on `claude-opus-5` is **512 tokens** — every paper clears it
   comfortably.

**CI assertion (this is the guard that makes it stick):**

```ts
// packages/ai/src/__tests__/caching.spec.ts
it('reuses the cached paper prefix', async () => {
  const a = await ai.comprehend(fixturePaper);
  const b = await ai.narrateScene(fixturePaper, fixtureScene);
  expect(a.usage.cache_creation_input_tokens).toBeGreaterThan(0);
  expect(b.usage.cache_read_input_tokens).toBeGreaterThan(0);   // ← the real assertion
  expect(b.usage.input_tokens).toBeLessThan(2000);              // only the task varies
});
```

If someone later interpolates a timestamp into the system prompt, this test fails and the
build stops. Without it, the regression is invisible until the bill arrives.

---

## 5. Batch API for the first pass

Initial narration for every scene is generated **after** the storyboard is proposed, while
the user is still on a progress screen. Latency is free there, so it runs through the
Batch API at 50% cost:

```ts
const batch = await client.messages.batches.create({
  requests: scenes.map((s) => ({
    custom_id: `narrate-${s.id}`,
    params: {
      model: 'claude-opus-5',
      max_tokens: 4096,
      system: NARRATION_SYSTEM,           // identical prefix across all requests
      messages: buildNarrationMessages(paper, s),
      tools: [narrationTool],
      tool_choice: { type: 'tool', name: 'record_narration' },
    },
  })),
});

// poll processing_status until 'ended', then stream results
for await (const r of client.messages.batches.results(batch.id)) {
  if (r.result.type === 'succeeded') apply(r.custom_id, r.result.message);
  else recordFailure(r.custom_id, r.result);
}
```

Two details that matter:

- **Results arrive in any order.** Key by `custom_id`, never by index.
- **The shared prefix caches across the batch**, so the 50% batch discount compounds with
  the ~90% cache read discount on the paper itself.

Interactive edits ("regenerate this scene's narration", "explain this differently") use
the streaming path — a user waiting on a click gets a streamed response, not a batch job.

---

## 6. Verification pass

Generation is not trusted on its own. After narration is produced, a deterministic
verification pass runs **in code, not in a model**:

| Check | Implementation | On failure |
|---|---|---|
| Number fidelity | Every numeral in the output must appear in the cited source text (allowing thousands separators and unicode minus) | → `unsupported/value-mismatch` |
| Qualifier retention | If the source statistic has CI/p/n and the output states the statistic, the qualifier must be present or explicitly deferred to a caption | → warning, offer *Add the interval* |
| Hedge level | Classify the output sentence's hedge; must be ≤ the source's | → `unsupported/hedge-strengthened` |
| Citation resolution | Every attributed claim must resolve to a `RefId` | → `unsupported/citation-unmatched` |
| Uncited factual text | Sentence contains a number, comparative, or causal verb but has no citation | → `unsupported/no-source` |

Doing this in code rather than with a second model call is deliberate: these are
mechanical properties, a regex is cheaper and more reliable than an LLM judge, and the
result is reproducible in a test.

---

## 7. Refusals and failure

`claude-opus-5` runs safety classifiers that can decline a request. A decline is an
HTTP 200 with `stop_reason: 'refusal'` — code that reads `content[0]` unconditionally
breaks on it. Every call goes through one wrapper:

```ts
async function call(params: MessageCreateParams): Promise<Message> {
  const res = await client.beta.messages.create({
    ...params,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',            // routes by refusal category, no model to maintain
  });

  if (res.stop_reason === 'refusal') {
    throw new AiRefusalError(res.stop_details?.category ?? null);
  }
  return res;
}
```

`AiRefusalError` surfaces in the UI as a specific, non-alarming message tied to the stage
that failed — *"We couldn't generate narration for this section. You can write it
yourself, or try regenerating."* — never a raw error, and never a silent empty scene.

**Other failure handling:**

| Failure | Response |
|---|---|
| `RateLimitError` | SDK retries with backoff (default 2); beyond that, queue the call and tell the user the stage is waiting |
| `max_tokens` stop | Retry once with a higher budget; if it recurs, split the task by scene |
| Tool arguments fail our own semantic check | One repair attempt with the validation error appended; then fall back to a hand-editable empty scene |
| Timeout | Streaming is used for any call that may run long, so timeouts are rare; on timeout, the stage is retried once |

---

## 8. Cost model

Worked example: a 12-page paper, 20 scenes.

| Item | Tokens | Rate | Cost |
|---|---|---|---|
| Cache write (paper + system, 1h TTL, 2×) | 45,000 | $5/M × 2 | $0.45 |
| Comprehension read (cache) | 45,000 | $5/M × 0.1 | $0.02 |
| Comprehension output | 2,000 | $25/M | $0.05 |
| 20 × narration reads (cache, batched) | 900,000 | $5/M × 0.1 × 0.5 | $0.23 |
| 20 × narration output (batched) | 12,000 | $25/M × 0.5 | $0.15 |
| 7 × alt text (vision + context) | 30,000 | $5/M | $0.15 |
| Haiku classification (sections, stats, refs) | 60,000 | $1/M | $0.06 |
| **Total** | | | **≈ $1.11** |

Without prompt caching, the narration reads alone would be $4.50 — **four times the whole
project's cost.** That is the entire reason §4 is written as an architectural rule with a
CI assertion rather than as advice.

Per-project cost is tracked and exposed in an internal dashboard, broken down by stage, so
a regression is attributable rather than a mystery line on an invoice.

---

## 9. Privacy

- API keys live only on the server. The browser never holds one, and no model call is
  ever made from the client.
- Uploaded PDFs are sent to the model only for the calls that need them, and only for the
  project that owns them.
- **No uploaded content is used for training.** This is stated on the upload screen, in
  the privacy page, and in the terms — all three, in the same words.
- Files uploaded via the Files API are deleted when the project is deleted, in the same
  job as the object-store sweep, and the deletion is verified before the job reports
  success.
- Model calls are logged with token counts and stage names, **never with content**. A
  support engineer can see that scene 4's narration cost 1,200 tokens; they cannot see the
  paper.
