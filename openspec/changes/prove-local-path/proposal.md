# Change: A turn on a small local model, at the 8,192-token window, on every push

## Why

R7 of the 2026-09-29 review (`openspec/reviews/2026-09-29-architecture-review.md`). "Local
by default" was the least exercised path: every test fakes Ollama, live runs use a hosted
model, and the fixed cost of a request stood at 4,516 tokens against the 4,526 compaction
trigger of the default 8,192 window. Nothing in CI ran a real small model. The review asked
for a CI job or for the claim to go; `AGENTS.md` makes the local-first path a hard rule, so
the claim stays and is proven.

## What Changes

- `scripts/local-path.ts`: one headless turn on an Ollama model held to a given window, in a
  throwaway project whose file the model must read to answer. It fails when the run does not
  end ok, when no tools were offered, or when a request did not fit the window, and reports
  whether the model read the file and answered right.
- `.github/workflows/local.yml` runs it on every push on the Linux runner, with
  `qwen2.5:1.5b` served by Ollama at an 8,192-token window, the model cached between runs.
- It is never run on the owner's machine, which cannot carry a local model well.

No spec deltas: the job proves an existing requirement; it adds no behavior.

## Impact

- `scripts/local-path.ts`, `.github/workflows/local.yml`.
