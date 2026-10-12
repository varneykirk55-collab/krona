import { AppError } from '../errors.js';
// Defense in depth, NOT a comprehensive PII/DLP classifier. Never log matches.
const patterns = () => [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:password|passcode|(?:phone\s+)?pin|api[ _-]?key|secret)\s*(?:is\s+|:\s*|=\s*)[^\s,;.]{4,}/gi,
];
export function containsCredentials(content: string): boolean {
  return patterns().some((p) => p.test(content));
}
export function rejectCredentials(content: string) {
  if (containsCredentials(content))
    throw new AppError(
      400,
      'CREDENTIAL_CONTENT_REJECTED',
      'Do not put passwords, phone PINs, private keys or API credentials in conversation or memory. Use the secure account settings or server environment instead.',
    );
}
export function redactCredentials(content: string): string {
  return patterns().reduce(
    (text, pattern) => text.replace(pattern, '[credential omitted]'),
    content,
  );
}
