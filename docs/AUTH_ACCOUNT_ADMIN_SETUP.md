# Rivora account and administrator upgrade — 9 November 2026

**Historical implementation snapshot.** The later administrator completion, current provisioning state, CSV workflow, dedicated layout and test results are documented in [ADMIN_BACK_OFFICE.md](ADMIN_BACK_OFFICE.md). Use that document for current administrator setup.

Implemented in the existing Express/MySQL/React application. The entire requested deployment is **not yet activated**: the designated owner account does not exist and KMA weather-warning recipient coverage lacks verified administrative mappings. Google OAuth credentials were subsequently configured locally; its authorization redirect is verified, but full account sign-in is not yet verified.

## Available functionality

- Existing splash and email/password accounts retained. Login now offers a server-validated guest preview and a clearly labeled Rivora-managed student login when university OIDC is unconfigured. Public KMA and flood-control information links remain available.
- User sessions use random, hashed-at-rest, HttpOnly cookies lasting 30 days, with SameSite=Lax and Secure in production. Logout, password changes, account disabling and admin revocation invalidate owned sessions. Existing bearer clients remain compatible and consult live account status/revocation time.
- Guest authorization lasts exactly three database-time minutes. A refresh/navigation does not renew it. A longer-lived guest cookie prevents renewal of that same expired preview. Creation is limited to three requests per IP per hour in the running server process; deleting cookies, changing identity or restarting the process means this is not an absolute per-person limit. Guest access is read-only except conversational requests; profiles, saved conversations, preferences and administrator APIs require a real user.
- Profile ownership comes from authentication, never a client user ID. Profiles support display name, documented province, separate announcement consent, existing station/official-flood subscriptions, explicit nearest-station detection, password change, verified email change and notification history. Google/OIDC identity emails cannot be changed as profile text. Explicitly declining location leaves essential monitoring available through the signed-in dashboard or controlled preview.
- Student IDs 253001–253050 are eligible identifiers only. The authenticated administrator assigns an actual email in the Students panel. The database enforces unique email and student ID. The initial password is a unique random inaccessible bcrypt hash. A 30-minute, single-use activation link verifies mailbox ownership and requires choosing a new password before student login becomes usable. No shared temporary password is created or delivered. The middleware additionally blocks accounts marked for initial password rotation from general APIs.
- `/admin` has server-enforced ADMIN authorization, live counts, searchable/paginated accounts, disable/enable/revoke actions, login/security audit records, student provisioning/resend, official-alert records and an announcement composer with recipient preview, current-password confirmation, content-bound five-minute preview tokens and idempotent queueing. Administrator accounts cannot be disabled or promoted through ordinary user actions.
- Announcements require separate opt-in and verified active addresses. A separate durable announcement delivery queue keeps them distinct from existing official-warning notifications; it rechecks consent and atomically claims jobs. Unknown SMTP outcomes are held rather than replayed. Only explicit pre-delivery rejection is retryable, up to three attempts. Queueing never claims successful delivery.
- Existing exact-station official-flood matching is preserved. Disabled accounts are excluded from its recipient and delivery queries. The failed ML warning classifier is not used for email generation.

## Additive database migration

Already executed successfully: `node account-migrate.js` from `backend`.

Added profile/role/status/student/consent/province/login/revocation fields to `users`, unique student IDs, and six tables: `account_sessions`, `guest_sessions`, `account_actions`, `account_audit`, `admin_messages`, `admin_message_deliveries`. Added the existing queue's missing `attempt_count` column and `sending` enum value to `email_notifications`. Existing user, preference and monitoring records were retained. The migration is repeatable and must run before starting a fresh deployment of this code. No runtime migration silently creates privileged accounts.

## Owner administrator setup

`ADMIN_EMAIL` is configured locally as `nishanxtha83@gmail.com`; no password is configured or hardcoded. The check found no account for that address, so **no ADMIN role was granted**.

1. Create the ordinary existing Rivora account using that email and a unique password of at least 12 characters; complete its real verification email.
2. Run `backend/scripts/provision-admin.ps1` in PowerShell. Enter the designated email and current account password in the hidden prompt. The helper passes credentials over stdin, never argv or a repository file. It verifies password ownership, verified email and active status before assigning ADMIN, revokes old sessions and audits the action.
3. Sign in again. The account menu and sidebar expose Administration; `/admin` is independently protected server-side.

No account was provisioned with a guessed password, and no real test email was sent. MFA was not added; strong-password reauthentication protects sensitive admin actions but is not MFA. Before Internet deployment, use HTTPS, `NODE_ENV=production`, a strong JWT secret and a trusted `APP_BASE_URL`/`API_PUBLIC_URL`. Application write requests require a trusted Origin plus a custom CSRF header for cookie-authenticated mutations. CORS is restricted to the configured app origin (and the documented local development origin).

## Google and university configuration

The existing authorization-code OIDC flow uses PKCE, nonce and state. Identity records bind issuer plus immutable subject and refuse unsafe automatic email-only linking. Verified provider-email changes are reconciled only for the same linked subject and cannot overwrite another user's email identity.

Set these backend environment variables using a real Google web OAuth client:

```
APP_BASE_URL=http://localhost:5173
API_PUBLIC_URL=http://localhost:5001
GOOGLE_CLIENT_ID=<Google web client ID>
GOOGLE_CLIENT_SECRET=<Google client secret, backend only>
```

Register `http://localhost:5001/api/auth/oidc/google/callback` as an authorized redirect URI. Use your actual HTTPS API origin in deployment and register that exact callback URI as well. Restart the backend and verify a real login; the configured authorization-start endpoint now returns HTTP 302 to accounts.google.com with PKCE S256, state, nonce and an HttpOnly state cookie. Three OIDC tests passed. Full consent/callback sign-in has not yet been completed. The already-declared openid-client dependency was missing locally and was installed using npm install --ignore-scripts --no-audit --no-fund. This reuses the existing standards-based browser OIDC flow, not a simulated Google button or a separate GIS widget implementation.

Approved university OIDC, if obtained, uses `UNIVERSITY_OIDC_ISSUER`, `UNIVERSITY_OIDC_CLIENT_ID`, `UNIVERSITY_OIDC_CLIENT_SECRET` and `/api/auth/oidc/university/callback`. No approved university SSO is currently configured. No claim of university identity verification is made for managed cohort IDs. No student accounts have been created because the ownership/email list is not available. Assign students individually through the protected panel; CSV import was not added.

## Email and official-area coverage

SMTP configuration is present, but no live send was exercised. `ENABLE_ADMIN_EMAILS` defaults to false. Set it to true only when operational announcement delivery is intended. Existing official-flood email switches remain separate (`ENABLE_AUTOMATIC_ALERTS`, `ENABLE_ALERT_EMAILS`, `ALERT_DRY_RUN`); this upgrade does not enable them automatically.

Official KMA heavy-rain/strong-wind records are visible in the protected alert view. Personalized weather emails remain **unimplemented/disabled pending verified coverage mapping**. Required evidence: the official KMA warning-region-code catalog with administrative/boundary definitions, effective-dated mappings between subscriber-selected administrative areas and those exact warning regions (including mountain/lowland/coastal exclusions), and warning identifier/version/cancellation semantics. A station's province, nearby gauge, display-name similarity or nearest distance cannot supply this evidence. Those missing mappings are not a Google/SMTP configuration issue. Do not enable weather emails merely by toggling `weather_enabled`.

## Retention and verification limits

Daily maintenance removes expired account/action sessions, keeps guest tombstones for one day and security audit records for 90 days, and redacts announcement bodies after 30 days. Audit rows contain user/actor IDs, action, outcome and time; no passwords, raw tokens, IP addresses or device coordinates are stored there. Existing account-deletion behavior was not replaced.

Focused backend tests: **35 passed** across `account-platform`, `auth-verification`, `oidc`, `location-preferences`, `registration-location`, `official-personalized-alerts` and `unified-email`. These include mocked identity ownership, initial password restrictions, single-use activation/recovery, profile ownership, cookie/CSRF rules, role denial/metrics, logout, message preview/idempotency and ambiguous SMTP outcomes. Focused frontend tests: **13 passed** across API requests, onboarding, nearest location and navigation/alert presentation. Changed-file ESLint and production build were run; see final task report for latest results.

Live local guest verification: **9/9 passed**, including actual database expiry and rejection of profile/admin/preferences. The script modifies and removes only its own temporary guest fixture. Results: `backend/reports/account-guest-verification.json`. The real browser also completed guest creation, refresh without resetting the countdown, natural expiration and automatic redirect to the explanatory sign-in page. A 390-pixel mobile check confirmed no document overflow and a reachable primary button. Screenshots are under `validation/accounts/`. Eight additional private Assist history/semantic regression checks passed (the repeated account cases are not counted twice). Profile/admin business flows were tested with isolated database/email doubles, not a provisioned live administrator. Real Google login, real student mailbox activation, real administrator ownership provisioning, real SMTP delivery and a full authenticated profile/admin browser walkthrough remain unverified until their prerequisites exist.

## Files changed for this upgrade

Backend: `account-migrate.js`, `account-sessions.js`, `account-actions.js`, `account-routes.js`, `account-maintenance.js`, `admin-messages.js`, `admin-routes.js`, `auth-middleware.js`, `auth-routes.js`, `oidc-routes.js`, `server.js`, `unified-alerts.js`, `unified-email-queue.js`, `.env.example`, local `.env` (designated email only), `scripts/provision-admin.js`, `scripts/provision-admin.ps1`, `scripts/verify-account-guest.js`, `tests/account-platform.test.js`, `reports/account-guest-verification.json`.

Frontend: `src/App.jsx`, `src/lib/auth.js`, `src/lib/apiFetch.js`, `src/lib/navigation.js`, `src/components/AccountMenu.jsx`, `src/components/Sidebar.jsx`, `src/components/StationOnboarding.jsx`, `src/pages/Login.jsx`, `src/pages/AuthCallback.jsx`, `src/pages/AccountAction.jsx`, `src/pages/Profile.jsx`, `src/pages/Admin.jsx`, `src/pages/Onboarding.jsx`, `src/pages/AlertPreferences.jsx`, `src/pages/AIAssistant.jsx`, `src/styles/accounts.css`, `tests/apiFetch.test.mjs`. Documentation: this file. No ML training, hydrological calculation, historical import, dependency addition or database rebuild was performed.
