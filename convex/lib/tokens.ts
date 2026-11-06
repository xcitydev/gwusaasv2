/**
 * Unguessable tokens for secret URLs, OAuth states and webhook credentials.
 * crypto.getRandomValues (not Math.random, which Convex seeds
 * deterministically) with rejection sampling so every character is uniform.
 */
export function secureToken(
  length = 32,
  alphabet = "abcdefghijklmnopqrstuvwxyz0123456789",
): string {
  const limit = 256 - (256 % alphabet.length);
  let token = "";
  while (token.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte >= limit) continue;
      token += alphabet[byte % alphabet.length];
      if (token.length === length) break;
    }
  }
  return token;
}
