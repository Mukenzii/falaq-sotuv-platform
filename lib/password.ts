/**
 * Passwords: hashing, verifying, generating, and the rules about them.
 *
 * Both implementations are plain ESM (lib/passwordHash.mjs and
 * lib/passwordRules.mjs) so that scripts/set-password.mjs can import them from
 * inside the production image, which is a Next standalone build with no tsx and
 * no .ts sources. This file is the server-side entry point and re-exports both,
 * so application code sees one module and there is one hash format.
 *
 * Client components must import '@/lib/password.shared' instead: pulling this
 * in would drag scrypt into the browser bundle.
 */
export { hashPassword, verifyPassword, DUMMY_HASH, generatePassword } from './passwordHash.mjs'
export * from './password.shared'
