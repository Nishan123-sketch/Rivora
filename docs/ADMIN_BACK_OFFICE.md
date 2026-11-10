# Rivora administrator back office

Implemented in the existing application and database on 9 November 2026. This supersedes the earlier admin section of `AUTH_ACCOUNT_ADMIN_SETUP.md`.

## Entry and current activation status

- Main entry: `http://localhost:5173/admin`; dedicated sign-in: `/admin/login`.
- The existing backend also serves the same production build at `http://localhost:5001/admin` and `/admin/login`. This is another entry into the same application, not another backend or database.
- The administrator layout has its own navigation: Dashboard Overview, All Users, Student Accounts, Pending Activations, Email Management, Login History, Alert Notifications and Admin Settings. Ordinary weather-monitoring navigation is absent from this layout. Return to Rivora opens the regular dashboard.
- Login reuses existing secure account sessions. The server independently checks live ADMIN role, active status, verified email and initial-password requirements on every admin request. Loading the public sign-in shell does not expose admin data.

Administrator provisioning is now **complete** for `nishanxtha83@gmail.com`. Following the owner's explicit activation and password-setting request, a local maintenance transaction checked the existing verified, active account, stored a bcrypt password hash, assigned ADMIN, revoked old sessions and account-action tokens, and audited the assignment. Actual sign-in and protected admin-overview requests both returned HTTP 200. The password is not stored in this document or repository source.

The helper below remains available for future owner-controlled provisioning; it is not necessary to run it again for the activated account:

```powershell
cd D:\Capstone\WeatherForecasting\backend
.\scripts\provision-admin.ps1
```

Enter the designated email and its existing strong account password in the hidden prompt. There is no default administrator password. The helper verifies the current password and mailbox-verification state, assigns ADMIN transactionally, revokes existing sessions and outstanding account-action tokens, and records an audit event. Sign in again afterward. If this is a Google-only account without a known local password, use the existing regular-login password-recovery workflow to establish a password through the verified mailbox first; this does not replace the linked Google subject.

MFA is not implemented by this change. The settings page recommends a strong unique password and provider MFA where available. Sensitive admin operations require current-password reauthentication and explicit confirmation.

## User management

User lists have server-side pagination (20 rows), search by name/email/student ID, account-type filters and active/inactive/pending filters. Details contain no password hashes, session tokens or OAuth credentials.

View / Edit / Activate opens a selected-account editor. Supported edits are display name, documented monitoring province/district, a station from the existing verified catalog and disabling existing notification consent. The edit is transactional, ownership-bound to the explicit target ID and audited. The user's own profile shows the saved details and station after refresh.

Administrators cannot grant announcement consent, enable warning consent where the user did not grant it, or transfer warning consent to a replacement station. A new station requires a fresh user opt-in before its emails can be enabled. Role, student identifier and Google/SSO identity are not ordinary editable profile fields.

Disable revokes sessions. Reactivate enables an already verified account; an unverified account remains PENDING. Activation invitations verify ownership and require a user-chosen password. They cannot simply mark an email verified. Email changes use a verification link; verified existing addresses remain unchanged until the replacement mailbox is verified. Pending local-account email corrections remain unverified and require activation. Google/SSO and other administrator identities cannot be silently changed through this workflow.

## Student provisioning and invitations

Eligible IDs are 253001–253050. No student email addresses or accounts were invented or populated during implementation.

Provision one student with the assigned real email, or import a strict CSV with header `student_id,email`. Import accepts at most 50 unique rows and 20 KB, validates identifiers and email syntax, and rolls back the entire transaction on a database conflict. It never overwrites an existing student password or user record.

CSV import creates PENDING accounts and sends **no emails**. Review the imported accounts and send invitations individually from their detail panels. One-at-a-time provisioning can send the initial invitation directly. Each account has a unique inaccessible random initial password hash, not a shared password.

The invited student opens the 30-minute single-use link, verifies ownership by possessing that mailbox link, chooses an individual password, and becomes ACTIVE. The student then signs in with their ID and password. Pending and disabled accounts cannot log in even when supplied with a correct password. Used, expired, superseded, failed and not-yet-issued invitations are visible in Pending Activations. Account and invitation actions are audited.

## Email management and current operational status

The composer reuses the existing SMTP service and durable announcement queue. Select individual/multiple eligible users in All Users or explicitly choose the opted-in group (maximum 100 per message). Preview filters support account type and documented saved monitoring province/district. These labels are not proof of residence or official warning coverage.

Only active, verified users with separate announcement consent qualify. Preview returns a count and a short-lived token binding the actor, exact eligible recipients and message content. Sending requires confirmation and administrator password reauthentication. Queue insertion is idempotent. Delivery eligibility/consent is checked again before an atomic job claim. History shows message-level results and paginated per-recipient status, attempts and timestamps. Explicitly rejected sends can retry within the existing attempt limits; ambiguous SMTP outcomes are held for review rather than automatically duplicated.

Activation/recovery mail, official warning notifications and optional announcements remain separate. Official warning records cannot be fabricated by administrators, and the failed ML warning classifier never triggers official-style notifications. Existing exact-station warning matching is preserved. Personalized KMA weather-warning emails still require independently verified administrative warning-area mappings; this work does not invent them.

The latest check verified **SMTP connectivity/authentication without sending a message**. Actual delivery was tested only through injected mock mailbox transport. No live test messages were sent to real users. `ENABLE_ADMIN_EMAILS` is currently false, so live announcement delivery and the corresponding UI queue/send control remain disabled. After administrator setup, review queued history and intended recipients, then set `ENABLE_ADMIN_EMAILS=true` in the existing backend environment and restart the backend when live delivery is intended. Existing official-warning delivery switches are unchanged.

## API endpoints

All `/api/admin/*` routes require server-side ADMIN authorization. Existing compatible names were reused instead of adding duplicate `/emails` or `/login-history` aliases:

- `GET /api/admin/overview`
- `GET /api/admin/users` with page/search/type/status; `GET` and `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/action` with DISABLE, ENABLE or REVOKE
- `POST /api/admin/users/:id/activation` and `/email-change`
- `GET` and `POST /api/admin/students`; `POST /api/admin/students/import`
- `POST /api/admin/students/:studentId/resend`
- `GET /api/admin/activations`
- `GET /api/admin/activity?kind=logins` or `kind=audit`, with optional user_id and page
- `GET /api/admin/messages`; `POST /api/admin/messages/preview`; `POST /api/admin/messages`
- `GET /api/admin/messages/:id?page=...`; `POST /api/admin/messages/:id/retry`
- `GET /api/admin/alerts`; `GET /api/admin/settings`

The overview uses aggregate MySQL queries for users, statuses, identities, subscriptions, recent login results and recorded notification delivery outcomes. Creation/audit timestamps stored in the database's verified local Korean time are normalized to UTC in the admin API before the UI formats KST. UTC-written last-login, expiry and delivery timestamps retain their original basis. Historical monitoring observations and warning timestamps were not changed.

## Additive migration and files

Executed `backend/admin-completion-migrate.js`: added `users.city`, extended account status with PENDING, created `account_invitations` and added its reference to `account_actions`. The existing `account-migrate.js` now includes this migration for fresh deployments. No users, student passwords, observations, forecasts or model records were deleted or reset.

Backend changes: `admin-routes.js`, `admin-user-service.js`, `admin-completion-migrate.js`, `account-migrate.js`, `account-actions.js`, `account-routes.js`, `account-sessions.js`, `auth-middleware.js`, `auth-routes.js`, `admin-messages.js`, `account-maintenance.js`, `oidc-routes.js`, `server.js`, `scripts/provision-admin.js`, `scripts/check-admin-readiness.js`, `tests/admin-completion.test.js` and `reports/admin-readiness.json`.

Frontend changes: `src/App.jsx`, `src/pages/Admin.jsx`, `src/pages/Login.jsx`, `src/pages/Profile.jsx`, `src/components/AdminLayout.jsx`, `src/components/AdminUserEditor.jsx`, `src/styles/admin.css`, `src/lib/auth.js`, `src/lib/adminPresentation.js`, `src/lib/navigation.js`, `src/lib/pageData.js` and `tests/admin-navigation.test.mjs`.

## Verification and boundaries

Focused backend suite: 51 passing tests across admin completion, account platform, email verification, OIDC, location preferences, official personalized alerts and unified email. This includes a full local HTTP email-preview/confirmation/queue/idempotency path followed by mock mailbox delivery, plus pending/disabled login rejection, CSV rollback, user edits reflected in profile output and private-field exclusion.

Focused frontend suite: 13 passing tests for admin routing, KST formatting, activation labels, API request security, existing onboarding and navigation/alert presentation. Changed-file ESLint and the production frontend build passed. The existing large MapLibre bundle advisory remains.

Live HTTP checks: backend `/admin` and `/admin/login` return 200; unauthenticated admin overview/users/students/activations/settings APIs return 401. The read-only readiness report confirms real database state and SMTP connectivity. Full authenticated browser operation remains unverified until the owner completes role provisioning; the attempted browser visual check timed out. No full weather/river/ML suite or new ML experiment was run. Existing relevant official-notification regressions passed, and monitoring calculations and API paths were not changed by this work.
