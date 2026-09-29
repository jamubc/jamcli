# Change: OpenAI's Responses API, reversed from "will not do"

## Why

R11 of the 2026-09-29 review (`openspec/reviews/2026-09-29-architecture-review.md`).
`docs/conformance.md` and `docs/feature-matrix.md` closed the Responses API as "will not do"
because OpenAI's documentation was blocked from an agent's build environment: a sandbox limit
written down as a product decision. Opening this unit found the record was also stale. Since
`872dd44` the OpenAI-compatible client asks a model through `/responses` once the endpoint
refuses it on Chat Completions. That client had never been checked against OpenAI's
definitions, and checking it found a real defect: it left `store` unset, and the API then keeps
every response for at least 30 days, where Chat Completions keeps none.

OpenAI's documentation site still refuses automated fetches. The same definitions ship in
OpenAI's Node SDK, generated from its API specification, and the client was checked against
`src/resources/responses/responses.ts` there.

## What Changes

- Every Responses request sets `store: false`.
- When an effort is set, the request asks for `reasoning.encrypted_content`. The encrypted
  reasoning item is kept on the message as a reasoning block and sent back ahead of the calls it
  led to, only to the OpenAI family and only from after the prompt's prefix last changed, the
  rule signed reasoning already follows.
- `docs/conformance.md` and `docs/feature-matrix.md` record the client as implemented.

## Impact

- Spec: `Generic Provider Endpoints` gains a scenario.
- Code: `src/core/providers/openai-compat.ts`, `src/core/types.ts`.
