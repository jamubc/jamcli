# Tasks

## 1. Gate

- [ ] 1.1 Remove `continue-on-error` and its comment from the gates job in
  `.github/workflows/ci.yml`.

## 2. Push and read the run

- [ ] 2.1 Push `master` to `origin`.
- [ ] 2.2 Read the CI run the push starts to the end. Fix anything it turns up on macOS,
  each fix with a test that fails without it.
- [ ] 2.3 `master` equals `origin/master`, and the run is green on both platforms.
