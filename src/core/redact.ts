/**
 * Replace credential values with a marker naming their source before tool output
 * reaches the model, a surface, or the log. A credential is the value of any environment
 * variable whose name says it holds one, plus values the caller names, such as keys read
 * from the credential store.
 */

const SECRET_NAME = /(_KEY|_TOKEN|_SECRET|_PAT|_CREDENTIALS?)$|^(API_KEY|TOKEN|SECRET)$|PASSWORD|PASSWD|SECRET_/i;
/** Shorter values are too likely to occur by chance to be worth replacing. */
const MIN_SECRET_LENGTH = 8;

export type Redactor = (text: string) => string;

type Secret = { name: string; value: string };

/**
 * `later` is asked again at every call, for credentials that become known after the
 * redactor is made, such as a key read from the store when a provider is switched to.
 */
export function createRedactor(
  env: Record<string, string | undefined> = process.env,
  extra: Secret[] = [],
  later?: () => Secret[]
): Redactor {
  const fixed: Secret[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH && SECRET_NAME.test(name)) {
      fixed.push({ name, value });
    }
  }
  fixed.push(...extra);
  const usable = (list: Secret[]) =>
    // Longest first, so a secret that contains another is replaced whole.
    list.filter((entry) => entry.value && entry.value.length >= MIN_SECRET_LENGTH).sort((a, b) => b.value.length - a.value.length);
  const always = usable(fixed);
  if (!always.length && !later) return (text) => text;
  return (text: string) => {
    if (!text) return text;
    const secrets = later ? usable([...fixed, ...later()]) : always;
    let out = text;
    for (const secret of secrets) {
      if (out.includes(secret.value)) out = out.split(secret.value).join(`[redacted:${secret.name}]`);
    }
    return out;
  };
}
