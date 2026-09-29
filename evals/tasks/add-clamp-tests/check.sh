set -e
test -f src/clamp.test.ts
test "$(grep -c 'test(' src/clamp.test.ts)" -ge 3
bun test ./src/clamp.test.ts
# The tests must catch a clamp that does nothing.
cp src/clamp.ts .clamp.saved
printf 'export const clamp = (value: number, _min: number, _max: number): number => value;\n' > src/clamp.ts
if bun test ./src/clamp.test.ts >/dev/null 2>&1; then mv .clamp.saved src/clamp.ts; exit 1; fi
mv .clamp.saved src/clamp.ts
