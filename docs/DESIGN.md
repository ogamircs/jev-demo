# Design notes

## Goal

Show how Jev (TypeSafe AI's "System One" model) works, with a UI that makes it easy to see, a fair comparison against OpenAI, and a published page anyone can open.

## What Jev is

Jev does not generate text. You send unstructured `state` plus typed `questions`. It returns typed decisions with probabilities in one parallel pass.

- Endpoint: `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`, model `jev-latest`.
- Question types: `choice` (pick one option), `score` (a position on 2 to 10 described levels, 0-based), `noul` (yes/no as a probability).
- Choice and score answers carry a full probability distribution plus a `confidence` number. Noul has no confidence field.
- All questions in one call are evaluated in parallel.
- Documented limits: no math, counting, date comparison, or text generation.

## The constraint that shaped the build

A published artifact is a static page under a strict content security policy. It cannot call outside APIs and must never contain keys. So one codebase produces two things:

1. **A local live app.** A small server keeps the keys and calls both APIs for real.
2. **A replay page.** The same UI driven by a recording of real runs, with a visible "recorded on" label.

The UI talks only to a data source. `web/source-live.js` posts to the local server. `web/source-replay.js` serves recorded exchanges at their recorded speed. The artifact build leaves the live source out and fails if any network API remains in the bundle.

## Guiding rules

- **Measure, never assert.** Latency, tokens and answers on screen come from real calls. Prices are list prices with a source and date. Vendor claims appear only as attributed quotes with links.
- **Show unflattering results.** If an engine gets an item wrong or its latency rises, the page shows it.
- **Give OpenAI its best configuration.** Cheapest adequate model, lowest reasoning effort, one strict structured-output call. The frontier model is an optional toggle, never the headline.
- **No impersonation.** No TypeSafe or OpenAI branding. The page is labelled as an independent demo.

## Fair comparison method

- **Timing.** `node:https` with a keep-alive agent rather than global `fetch`, so connection reuse is known. Each call returns `reusedSocket`, `connectMs`, `tlsMs`, `ttfbMs`, `totalMs`, plus the server-side time each API reports in a response header.
- **Warm connections.** Both hosts are warmed at startup. Before any burst of concurrent calls, enough connections are opened first, outside the timed window. Cold samples are kept in the file and left out of medians.
- **Sampling.** Engines alternate. The page reports the median, the range and every sample. No percentiles.
- **Caching.** The probe compared identical requests with requests carrying a unique id and found no response cache on Jev.
- **OpenAI call shape.** Responses API, strict JSON schema, `store: false`. Instructions and criteria go in the prompt once. The schema holds only the allowed values. The race asks for labels only. Only the confidence section adds a self-reported confidence field, because it adds output tokens.
- **Models.** Never hardcoded. They are discovered with `GET /v1/models` and matched against `config/models.json`. A reasoning-effort ladder (`none`, `minimal`, `low`, not sent) is walked during warm-up and the accepted value is shown on screen.
- **Agreement rules.** Score compares Jev's most probable level with OpenAI's integer level. Noul compares `p >= 0.5` with the boolean.

## Honest scenarios

- All 14 tickets, their author labels and difficulty tiers were written before the first recorded run. The recording stores a hash of the scenario file.
- About a third are clear, a third borderline, and a third hard or aimed at Jev's documented weak spots: negation, sarcasm, two intents in one message, a long thread with irrelevant detail, a non-English message.
- One input is a long forwarded thread of roughly 2,500 to 3,200 tokens, because short inputs flatter both engines.
- No ticket was removed after seeing results. For tickets that are ambiguous by design, sending them to a person counts as the correct outcome.

## Local server security

Binding to localhost is not enough, because any web page open in the same browser could post to it and spend the keys. The server checks `Host` and `Origin`, rejects cross-site requests, requires a JSON content type, sends no CORS headers, caps body size, and rate-limits upstream calls. Upstream 401 bodies echo a masked fragment of the key, so 401 text is replaced wholesale before it reaches the browser or a recording.

## What changed during the build

- **The probe corrected assumptions.** Jev accepted a one-level `score` question although the docs require two. Its validation errors use a FastAPI-style `detail` body. OpenAI showed no first-use schema penalty in our test.
- **A fairness bug in our own page.** Two Jev calls fired together at page load, so the second opened a new connection and paid for TLS setup, which doubled its time. The fix was connection pre-warming before concurrent bursts and sequencing the first two calls. Everything was re-recorded afterwards. The final recording has zero cold samples and zero failures.
- **Outliers flattened the fan-out chart.** A few slow samples in the one-call-per-question series stretched the axis to 10 seconds. The axis now scales to the medians, and samples above it are pinned to the top edge and labelled with their time. Those slow samples ran on warm connections, so they are real tail latency: a burst of parallel calls is as slow as its slowest call.
- **Prompt caching showed up in costs.** OpenAI bills a repeated long prompt at a lower cached rate. The cost math already handled it, but the table hid it. Cached tokens are now shown.
- **Copy stopped presupposing results.** The limits section was written expecting Jev to fail. It got all three cases right in the recording and two of three in a later live run, so the section now reports a computed tally and flags answers near p = 0.5 as close to a coin flip.
- **Cut from scope.** A repeatability section, banking and smart-home scenarios, full question editing, logprobs, and any accuracy percentage.
