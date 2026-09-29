# Change: Run the release job end to end, short of what publishes

## Why

R12 of the 2026-09-29 review (`openspec/reviews/2026-09-29-architecture-review.md`). The release
job, with its SBOM and provenance, has never run (`docs/conformance.md`). It runs only on a
pushed `v*` tag, and two of its steps publish the moment it does: the tag is public, and the
provenance attestation of a public repository is written to Sigstore's public transparency log,
which cannot be taken back. Those two are the owner's to trigger. Everything before them can be
run now and fixed where it breaks.

## What Changes

- `release.yml` also runs on demand as a dry run: install with every platform's native library,
  the gates, the four compiles, the Linux binary's smoke test, and the SBOM, with the binaries,
  checksums, and SBOM kept as the run's artifacts. The attestation and the draft release run only
  for a tag.
- The dry run is run on GitHub, and what it turns up is fixed.

No spec deltas: this is the release pipeline, and no requirement describes it.

## Impact

- `.github/workflows/release.yml`, and whatever the run turns up.
