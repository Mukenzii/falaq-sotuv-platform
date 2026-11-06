/**
 * The login and password rules, for code that must not pull in node:crypto —
 * the admin screen and the change-password screen are client components.
 *
 * The implementation is lib/passwordRules.mjs, in plain ESM so that
 * scripts/set-password.mjs can import it inside the production image, which
 * has no TypeScript in it. This file only re-exports, so every existing
 * `@/lib/password.shared` import keeps working.
 */
export {
  USERNAME_RE, MIN_PASSWORD,
  normalizeUsername, usernameProblem, passwordProblem, suggestUsername,
} from './passwordRules.mjs'
