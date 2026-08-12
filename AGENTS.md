# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Maintenance contract

- **Hai file hướng dẫn phải đồng bộ.** `CLAUDE.md` (cho Claude Code) và `AGENTS.md` (cho Codex) dùng chung một thân nội dung: mọi thứ từ `## Commands` tới cuối file phải **giống hệt nhau từng byte**. Chỉ phần tiêu đề và mục Maintenance contract này được phép khác. Sửa kiến thức dự án ở một file thì phải chép sang file kia trong **cùng một thay đổi** — đừng để lần sau mới làm.
- Kiểm tra bằng máy, đừng tin trí nhớ: `npm run docs:check` (hoặc `npm run test:tenant`) sẽ báo lỗi và chỉ ra dòng đầu tiên bị lệch. Chạy nó trước khi bàn giao bất kỳ thay đổi nào có đụng tới hai file này.
- **Trước khi merge nhánh `hoangsonbusiness`, đọc mục "Merging the `hoangsonbusiness` fork".** Nhánh đó có lineage cũ hơn; hai lần merge trước đã âm thầm xóa mất công việc đã có trên `main` (9 hạng mục, gồm cả bug mất dữ liệu và build frontend chết). Mục đó có danh sách file rủi ro và cổng kiểm tra bắt buộc.
- Read `rule.md` before changing tenant domains, role ownership, database planes, operational logs, Terraform, or deployment configuration. Add newly discovered regression risks to that file in the same change.
- This rule documents behavior observed in source at `main` commit `752448f` (2026-08-08). If code and this file differ, verify the code path and update this rule in the same change.
- The reusable Codex skill is `D:\Codex-Skills\e-proc-platform`. Keep its `references/features.md`, `references/api-map.md`, architecture, and verification guidance synchronized with material feature, role, schema, infrastructure, or deployment changes.
- Preserve user-owned modified/untracked files. Inspect `git status` before editing and before delivery.
- Treat security-sensitive frontend controls as UX only; enforce the same rule in backend middleware, route ownership checks, and SQL scope.
- For changes that cross a documented coupling boundary, update every listed file and add regression coverage. Do not patch only the visible UI or only one of the duplicated exam/practice flows.

## Commands

### Backend
- Install root dependencies: `npm install`
- Run backend dev server: `npm run dev`
  - Starts the TypeScript server from `src/server/server.ts` via `tsx`
- Build backend TypeScript: `npm run build:server`
- Verify critical server runtime dependencies: `npm run deps:verify`
  - Resolves and loads `base64-js` and `mammoth`; deploy must stop before database or PM2 work if this fails
- Ensure the three configured PostgreSQL databases exist: `npm run db:ensure`
  - Requires explicit, distinct `DATABASE_URL`, `CONTROL_DATABASE_URL`, and `LOG_DATABASE_URL`; creates missing databases only and requires PostgreSQL `CREATEDB` privilege
- Migrate all three configured database schemas: `npm run db:migrate`
  - Runs assessment, global control, then tenant log initialization; stops on the first failure and closes all migration connections
- Run built backend: `npm start`

### Frontend
- Install frontend dependencies: `cd client && npm install`
- Run frontend dev server: `cd client && npm run dev`
  - Vite dev server runs on port `5173`
  - `/api` is proxied to `http://localhost:3001`
- Build frontend: `npm run build:client`
  - This builds into `client/dist`

### Full build
- Build both frontend and backend: `npm run build`

### Runtime
- Node.js 22 or newer is required by both root and client manifests. Run `node scripts/verify-node-version.mjs` before dependency installation on deployment hosts; Tailwind Oxide 4.3.3 may be silently omitted as an incompatible optional dependency under Node.js 18.

### Type-check only (no emit)
- Backend: `npx tsc --noEmit` (from project root)
- Frontend: `npx tsc --noEmit` (from `client/`)

### Maintenance harness
- Run the project wrapper with the applicable design spec: `python scripts/run-code-harness.py --target <changeset-folder> --rules specs/fullstack-harness.rules.json --spec specs/<feature>-design.md --report <report-folder>`.
- `--spec` must identify the requirements used by every pending `llm_judge`; do not run the final maintenance gate against an undocumented feature change.

## Git workflow (bắt buộc cho mọi thay đổi)

**Không commit thẳng lên `main`.** Mọi thay đổi phải đi qua nhánh riêng rồi merge:

```bash
git checkout -b codex/<mô-tả-ngắn>     # TRƯỚC khi sửa file đầu tiên
git commit
git push -u origin codex/<mô-tả-ngắn>
git checkout main && git merge --no-ff codex/<mô-tả-ngắn> && git push origin main
```

Lý do không phải hình thức. Đây là repo đang phục vụ production thật
(`epoc.devfasttrack.cloud`), và đã có tiền lệ một merge âm thầm xóa mất công việc đã
có: merge `ed8b5aa` xóa 9 hạng mục, gồm cả bug mất dữ liệu và build frontend chết
(xem mục kế tiếp). `--no-ff` giữ lại ranh giới của từng thay đổi trong lịch sử, nên
revert được một thay đổi mà không đụng tới những thay đổi khác. Commit thẳng lên
`main` hoặc `merge --squash` đều làm mất ranh giới đó.

Tạo nhánh **trước** khi sửa file đầu tiên, không phải sau khi đã sửa xong. Nếu lỡ
commit thẳng lên `main` và đã push thì nói thẳng ra; đừng dựng một merge commit giả
để trông giống quy trình, vì viết lại lịch sử `main` đã public cần force-push nên
phải hỏi người dùng trước.

## Merging the `hoangsonbusiness` fork (read before every such merge)

`hoangsonbusiness/main` is a **long-lived fork on an older lineage**, not a topic branch. Merging it has twice silently reverted work that was already on `main` — the conflict resolution took the fork's whole file, and nobody noticed until the bug resurfaced in production.

Tailwind v4/Oxide requires Node.js 20+ and a platform-native package; the supported application runtime is Node.js 22+. Keep both manifests/lockfiles at Node.js 22+, install Node.js 22 in both EC2 bootstrap paths, keep `@tailwindcss/oxide-linux-x64-gnu` explicit in client optional dependencies, install with `--include=optional` in deploy/setup, and run the runtime gate before install plus `client`'s `deps:verify` before Vite. Under Node.js 18, npm may silently omit the incompatible optional binding; a stale cross-platform install can also pass locally and fail while loading `vite.config.ts` on Linux.

**Merge `ed8b5aa` alone deleted nine things.** All are restored now; the list is here so a future merge is recognised for what it is rather than re-debugged from scratch:

| Bị mất | Hậu quả |
|---|---|
| Khóa kép `(id, question_group)` + toàn bộ tính năng bộ đề | Import bộ đề thứ hai **xóa trắng** 100 câu của bộ thứ nhất |
| `question_plain` | Prompt chấm AI nhận HTML thô, model đọc lẫn `<p>`/`<strong>` |
| Blueprint chọn theo cặp (module, bộ đề) | Đề thi trộn câu từ mọi bộ trùng tên module |
| Bản vá `INSERT ... RETURNING` cho SQLite | Học viên được tạo nhưng **không gán câu hỏi nào** |
| `FileCache.dataDir` khởi tạo ở class field | `npm run dev` crash ngay khi khởi động |
| Toàn bộ tính năng Practice (bảng + route) | `/admin/practice` và `/practice` gọi endpoint không tồn tại |
| `JSCPP`, `monaco-editor` trong `client/package.json` | `npm ci` sạch → **build frontend chết**, deploy fail |
| Vitest + Testing Library + script `test` | `npm test` của client biến mất trong im lặng |
| SSL cho kết nối `db:ensure` | Deploy chết ở bước tạo database (SQLSTATE 28000) |

### Nguyên tắc khi resolve

- **Không bao giờ lấy nguyên bản của fork cho file dùng chung.** `main` là nguồn đúng cho phần đã có; chỉ ghép thêm tính năng mà fork có còn main chưa có.
- File rủi ro cao, phải đọc kỹ từng hunk: `src/server/db/postgres.ts`, `src/server/routes/admin.ts`, `src/server/routes/student.ts`, `src/server/cache.ts`, `client/package.json`, `client/src/pages/BatchManagement.tsx`, `client/src/services/api.ts`.
- Sau khi resolve, grep nhanh các bất biến trước khi chạy test: `ON CONFLICT (id, question_group)`, `question_plain`, `practice_exams`, `upper.includes('RETURNING')`, `JSCPP`.

### Cổng kiểm tra bắt buộc — chạy SAU khi merge, TRƯỚC khi push

```bash
npm run test:tenant          # bắt khóa kép, RETURNING, practice, recording policy, docs lệch
npx tsc --noEmit             # backend
cd client && npx tsc --noEmit && npm test
```

Và **quan trọng nhất**, thứ mà chỉ cài sạch mới lộ ra:

```bash
cd client && rm -rf node_modules && npm ci && npm run build
```

Dependency bị gỡ khỏi `package.json` vẫn build xanh khi `node_modules` cũ còn sót gói đó. Chỉ `npm ci` mới phát hiện — mà đó đúng là việc `deploy/scripts/deploy.sh` làm trên server, nên bỏ qua bước này nghĩa là để deploy chết thay mình.

## Repository structure

This is a full-stack technical assessment platform with a React/Vite frontend and an Express/TypeScript backend.

### Source of truth vs generated artifacts
- **Edit application source in**:
  - `client/src/**` for frontend
  - `src/**` for backend and shared server-side logic
- **Do not treat these as source of truth** unless you are intentionally updating deployed/static artifacts:
  - `public/assets/**`
  - `client/dist/**`
  - `server/**`
  - `index.js`
- Important: the app may be served from `public/index.html`, which points to a specific built asset in `public/assets`. After changing frontend source, rebuilding `client/dist` alone is not enough if runtime is using `public/`; you must also sync the new built asset into `public/assets` and update `public/index.html` to the new hashed filename.

## High-level architecture

### Frontend
- Main router: `client/src/App.tsx`
- Student flow routes:
  - `/` → login (access code entry)
  - `/confirm` → confirm email / start exam
  - `/exam` → active exam page
  - `/submit` → submission complete page
- Admin flow routes:
  - `/admin/login` is the tenant `admin`/`tenant_admin` login. Legacy `/admin` redirects here.
  - `/tenant/login` is the global `superadmin` login.
  - `/tenants` is the superadmin-only global tenant control plane.
  - `/admin/dashboard`, `/admin/questions`, `/admin/batches`, `/admin/batches/:id/students`, `/admin/batches/:id/results`, `/admin/settings`, `/admin/practice`, and `/admin/issues` belong to the current tenant. Both `admin` and `tenant_admin` may use them; superadmin may not.
  - `/admin/users` is current-tenant user management and is restricted to `tenant_admin`.
- API wrapper: `client/src/services/api.ts`
  - `adminApi` contains current-tenant auth, CRUD, and reporting endpoints; attaches admin JWT via request interceptor
  - `client/src/services/tenantControlApi.ts` contains superadmin auth and global tenant-control endpoints
  - `studentApi` contains exam lifecycle endpoints and violation reporting; attaches student JWT via request interceptor (see **Student auth** section below)

### Backend
- HTTP server entry: `src/server/server.ts`
- Express app setup: `src/server/index.ts`
  - mounts `/api/tenants` (global control), `/api/admin` (tenant administration), `/api/admin/issues` (tenant log plane), and `/api/student`
  - exposes health (`/api/health`) and internal diagnostic endpoints (require admin JWT)
- Tenant auth/resource routes: `src/server/routes/adminAuth.ts` and `src/server/routes/admin.ts`
- Global auth/resource routes: `src/server/routes/tenantAuth.ts` and `src/server/routes/tenants.ts`
- Shared credential/JWT policy service: `src/server/services/adminAuthentication.ts`
- Student routes: `src/server/routes/student.ts`
- Middleware:
  - `src/server/middleware/auth.ts` — admin JWT middleware (`authMiddleware`)
  - `src/server/middleware/studentAuth.ts` — student JWT middleware (`studentAuthMiddleware`)

### Data/storage model
- The database is split into three ownership planes. Never configure one plane to fall back to another:
  - **FSA-CLS assessment data-plane:** `src/server/db/postgres.ts`; `DATABASE_URL` in production or `data/eaudit.db` locally. It owns questions, batches, students, submissions, violations, and assessment/AI state. `data_plane_metadata` identifies this database as tenant `fsa-cls`.
  - **Global tenant control-plane:** `src/server/db/controlPlane.ts`; `CONTROL_DATABASE_URL` in production or `data/control-plane.db` locally. It owns only `admin_users`, `tenants`, `tenant_provision_jobs`, and `tenant_audit_events`.
  - **Per-tenant operational log-plane:** `src/server/db/logPlane.ts`; `LOG_DATABASE_URL` in production or `data/tenant-logs.db` locally. It owns `log_plane_metadata` and `tenant_issue_logs`. It records bounded HTTP 4xx/5xx operational events and is immutably bound to `TENANT_SLUG`. It must not store request/response bodies, headers, query strings, JWTs, secrets, stack traces, or candidate anti-cheat evidence.
- Startup initializes assessment data-plane, global control-plane, tenant log-plane, then cache/queue. It copies legacy admin/tenant rows without changing password hashes and maps tenant slug `fsa` to `fsa-cls`.
- Legacy control tables remain in the data database only for rollback. All runtime authentication, tenant configuration, provisioning jobs, and tenant audit writes must use `controlPlane.ts`.
- Production startup fails if `CONTROL_DATABASE_URL` or `LOG_DATABASE_URL` is missing. Neither may fall back to `DATABASE_URL`.
- Core tables are created in the DB layer on startup:
  - `question_bank`
  - `batches` (has nullable `practice_exam_id` — set = the batch is a Practice batch, see **Practice exams** below)
  - `students`
  - `exam_questions`
  - `violations`
  - `violation_events` (append-only forensic log — one row per violation occurrence; see Anti-Cheat v2 section)
  - `ai_queue` (has `kind` column: `'exam'` grades an `exam_questions` row, `'practice'` grades a `practice_submissions` row — for practice jobs, `exam_question_id` actually holds the `practice_submissions.id`)
  - `ai_settings`
  - `practice_exams` / `practice_submissions` (see **Practice exams** below)
  - `data_plane_metadata`
- Control-plane tables are `admin_users`, `tenants`, `tenant_provision_jobs`, and `tenant_audit_events`.
- `question_bank` columns relevant to import/grading/export (see "Question bank: groups and HTML-safe plain text" below):
  - `module` — topic/category (e.g. "Pointers", "OOP")
  - `question_group` — nullable, names the question set a question belongs to (e.g. `CPP_PRINT_IOT`, `CPP_EMB_AUTOSAR`), used to disambiguate question sets that otherwise share the same `module`/`level`/`type` framework
  - `question_sample` — original content as imported, may contain HTML markup (rendered to students via sanitized `dangerouslySetInnerHTML`)
  - `question_plain` — nullable, HTML-stripped plain-text version of `question_sample`, auto-generated at import time; used anywhere the question text is consumed by something other than the student-facing renderer (AI grading prompts, Excel export)
### Security model

#### Admin authentication, tenants, and roles
- Authentication is split by ownership plane. `/admin/login` calls `POST /api/admin/login` and accepts only matching-tenant `admin`/`tenant_admin`; `/tenant/login` calls `POST /api/tenants/login` and accepts only global `superadmin`. Valid credentials submitted to the wrong endpoint are denied before a JWT is issued.
- Both endpoints use the shared `adminAuthentication.ts` service and return a 24-hour HS256 JWT carrying account id, username, role, and tenant context. The frontend stores the token, expiry, role, user id, tenant id/slug/name in `localStorage` and sends `Authorization: Bearer <token>`.
- All protected admin routes use `authMiddleware`. It verifies the JWT and then reloads the account and tenant from the database on every request, so deleted accounts, changed roles/tenant assignments, and suspended tenants lose effective access immediately.
- Roles are `superadmin`, `tenant_admin`, and `admin`:
  - `superadmin` is global, has no `tenant_id`, and manages tenant configuration/approval/provisioning through `/tenants` and `/api/tenants`. It cannot read or mutate tenant assessment data or tenant users. It may read a selected tenant's safe operational issue rows only through `GET /api/tenants/:id/issues`; it cannot use or mutate `/api/admin/issues`.
  - `tenant_admin` belongs to exactly one tenant and owns all audit/assessment functions for that tenant, including tenant user management, recording-mode configuration, and operational-log lifecycle management. It does not edit global tenant/Terraform configuration.
  - `admin` belongs to exactly one tenant and may use question-bank, batch, result, practice, AI-setting, dashboard, and read-only issue-log routes only on a server whose current `TENANT_SLUG` matches its JWT tenant.
- `requireTenantDataAdmin` protects tenant assessment and issue-list routes; `requireTenantLogManager` protects issue lifecycle mutations; `requireTenantUserManager` protects current-tenant user CRUD; `requireSuperAdmin` protects `/api/tenants`. The legacy `requirePlatformAdmin` export aliases `requireTenantDataAdmin` and therefore excludes superadmin.
- **Vai trò `admin` nghĩa là giáo viên/cộng tác viên, không phải quản trị viên cao nhất.** Trong một tenant, `tenant_admin` quản lý người dùng và có toàn quyền; `admin` là người dùng thường và **chỉ sửa/xóa được ngân hàng câu hỏi và đợt thi do chính mình tạo** (`uploaded_by`/`created_by`). Cái tên này đã gây ra hai lớp lỗi cùng lúc: bốn kiểm tra viết `role !== 'admin'` nên giới hạn đúng người nhiều quyền hơn và thả cửa cho giáo viên; và validate của `POST /users` nhận `'admin'|'mod'` theo mô hình vai trò đã bỏ, khiến tạo `tenant_admin` luôn trả 400 còn `'mod'` lại tạo ra tài khoản chết. Trước khi sửa quyền ở `admin.ts`, đọc lại bảng vai trò phía trên.
- **Toàn bộ CRUD `/api/admin/users` phải dùng `controlPlane.ts`.** `admin.ts` import cả `db` (data-plane) lẫn `controlDb`, và bốn route người dùng từng chạy nhầm trên `db`: danh sách luôn rỗng dù tenant có tài khoản thật, tài khoản tạo ra không đăng nhập được, và nguy hiểm nhất là **xóa báo thành công nhưng tài khoản thật vẫn đăng nhập bình thường**. `PUT /users/:id` còn không tồn tại dù client vẫn gọi, nên đổi vai trò và đặt lại mật khẩu đều nhận 404 trong im lặng. Đã sửa; test hồi quy khẳng định mọi truy vấn `admin_users` đi qua `controlDb`.
- Frontend `PrivateRoute`, `AdminNav`, and hidden controls are UX only. Backend middleware and tenant-scoped SQL/ownership checks are the security boundary.
- Every non-superadmin account requires `tenant_id`. Startup assigns null/legacy-FSA non-superadmin accounts to `fsa-cls`; accounts explicitly belonging to another tenant remain unchanged. The data-plane default is `fsa-cls` (`TENANT_SLUG`, then `DEFAULT_TENANT_SLUG`, then `fsa-cls`).
- A suspended tenant is blocked at login and by authenticated requests. Current code does not block a `pending` tenant from tenant-management login; `approved` is enforced before Terraform plan/apply. Treat this as an implementation fact and a requirement gap if product policy says only approved tenants may use the application.
- FSA-CLS is the tenant this server itself runs as, not a submission awaiting review, so startup keeps it `approved`/`active`. `resolveFsaClsLifecycle()` in `controlPlane.ts` promotes a `pending` row on every boot and stamps `approved_by`/`approved_at`. It deliberately never touches `suspended` — auto-unsuspending would silently undo a superadmin decision. Before this existed the INSERT set `approved` but the follow-up UPDATE only fixed `domain_name`/`app_url`, so a row copied from the legacy control plane kept the schema default `pending` forever and was blocked from Terraform plan/apply.
- User-management safeguards: no self-delete, self-role/tenant change, or self password reset through user CRUD; preserve the last tenant admin; tenant admins cannot access or create superadmins or cross-tenant users. Superadmin is not a tenant user manager.
- Recording mode per batch (`none`, `local`, `s3`) can only be enabled/changed by `tenant_admin`; backend enforcement is authoritative and `record_enabled` remains a compatibility mirror for S3.
- Internal diagnostic endpoints (`/api/test-db`, `/api/queue/*`, `/api/cache/flush`, `/api/stats`) also require admin JWT
- **Self-service admin registration has been removed.** The 2026-07 hardening note claimed this, but `GET /is-initialized` and `POST /setup` survived in `admin.ts` above `router.use(authMiddleware)` and stayed reachable **unauthenticated** on production until 2026-08-12 (verified live: `is-initialized` returned `{"initialized":false}` and `setup` with an empty body returned 400, so the handler ran with no auth in front of it). They wrote to the **data-plane** copy of `admin_users`, which no longer backs authentication, so the account could not log in — but it was still an unauthenticated write to the production database, and a full login bypass the moment the mount order in `index.ts` changed. Both routes are deleted and `src/server/routes/adminUserRoutes.test.ts` fails if any route reappears above `authMiddleware`. Instead:
  - The first `admin_users` row is seeded automatically in the control-plane by `seedSuperAdmin()` in `src/server/db/controlPlane.ts`, **only when the table is empty** — username/password default to `supperadmin` / `superadmin123#2nf` (role `superadmin`), overridable via the `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` env vars. **Change this password immediately after first login** (`PUT /api/tenants/change-password`) — the default lives in git history.
  - Other tenant accounts are managed through `GET/POST/PUT/DELETE /api/admin/users` by that tenant's `tenant_admin` only.
  - The first FSA-CLS `tenant_admin` is seeded by `seedFsaTenantAdmin()` in `src/server/db/controlPlane.ts`, **only when that tenant has no `tenant_admin` yet and the username is free** — defaults `adminfsa` / `adminfsa123#2nf`, overridable via `FSA_TENANT_ADMIN_USERNAME` / `FSA_TENANT_ADMIN_PASSWORD`. This is required because `superadmin` deliberately cannot read or mutate tenant assessment data and is not a tenant user manager, so a freshly provisioned server would otherwise have no account able to open `/admin/*`. **Change this password immediately after first login.**
  - Global tenant control login lives at `/tenant/login` and management lives at `/tenants`; legacy `/admin/tenants` only redirects to management. `/admin/tenant` has been removed and redirects to the tenant dashboard. Server-side ownership checks remain authoritative.

#### Student authentication
After the security hardening (2026-07), student auth works via a signed JWT rather than an unverified header:

1. Student enters access code → `POST /api/student/verify`
2. Server validates and returns `student_token` (JWT, `expiresIn: 4h`, payload: `{ studentId, batchId }`)
3. `StudentLogin.tsx` passes token through React Router state → `StudentConfirm.tsx`
4. On "Start exam", `StudentConfirm.tsx` stores `studentToken` and `studentId` in `localStorage`
5. All subsequent student API calls (`getQuestions`, `saveAnswer`, `submit`, `reportViolation`, etc.) attach the token via the axios request interceptor in `api.ts`
6. Backend `studentAuthMiddleware` verifies the JWT; `req.studentPayload.studentId` is the authoritative source — **`x-student-id` header is no longer used or trusted**
7. `POST /exam/disconnect` (sendBeacon) cannot set custom headers, so the token is placed inside the request body (`student_token` field); `studentAuthMiddleware` accepts it from either location

When debugging student exam state, inspect:
- `localStorage.studentId` (display only, not used for auth)
- `localStorage.studentToken` (JWT used for all student API calls)
- Network `Authorization: Bearer ...` header on student requests

#### CORS
- `ALLOWED_ORIGINS` env var controls which origins are permitted (comma-separated)
- Default: `http://localhost:5173`
- For production Vercel deploys: set `ALLOWED_ORIGINS` to the actual deployment URL(s) in the Vercel environment variable dashboard

### Exam lifecycle
- Student verification and exam start live in `src/server/routes/student.ts`
- Frontend exam behavior lives mainly in `client/src/pages/StudentExam.tsx`
- Answers are not written directly on every keystroke:
  - frontend debounces saves (2-second debounce)
  - backend buffers answers through `src/server/cache.ts`
  - buffered answers are flushed periodically or on submit
- Violations are reported from the frontend through `studentApi.reportViolation(type)` and stored in the `violations` table
- Accepted violation types (server-enforced whitelist in `src/server/routes/student.ts`, `validTypes`): `tab_switch`, `fullscreen_exit`, `copy_attempt`, `cut_attempt`, `paste_attempt`, `devtools_open`, `extension_panel`, `screenshot_attempt`, `print_attempt`, `suspicious_paste`, `focus_lost`, `recording_stopped`
- Locking occurs when `violation_count >= 2` for any single type or `total_violations >= 2`. **As of 2026-07-29 the log-only exemption was removed** — `suspicious_paste` and `focus_lost` are now lockable like every other type and count toward `total_violations` (see Anti-Cheat v2 section for the rationale behind the change). **`recording_stopped` is a special case: it locks the exam on the FIRST occurrence** (see Screen recording section) — stopping the screen share is treated as deliberate evasion.
- Every violation report is additionally appended to the `violation_events` table (append-only forensic log); `suspicious_paste` events carry a `content_preview` (first 500 chars of the pasted text) — see Anti-Cheat v2 section
- Anti-cheat behavior is concentrated in `client/src/pages/StudentExam.tsx`:
  - clipboard attempts (`copy_attempt`, `cut_attempt`, `paste_attempt`) are intercepted inside the Monaco CodeEditor via `addCommand()` and reported as violations
  - fullscreen exit triggers a 5-second grace period timer; if the student stays out of fullscreen past the timer, `fullscreen_exit` is recorded and the exam is force-submitted
  - tab switching (visibilitychange) reports `tab_switch` violation
  - DevTools key shortcuts (F12, Ctrl+Shift+I/J/C/K, Ctrl+U) are blocked and report `devtools_open` violation (with 10-second cooldown)
  - `beforeprint` reports `print_attempt`; PrintScreen key reports `screenshot_attempt`
  - **Extension side-panel detection (`extension_panel`, added 2026-07)**: detects Chrome side-panel extensions (e.g. Monica AI) that open alongside the exam while remaining fullscreen. See dedicated subsection below — the detection metric matters and is easy to get wrong.
  - locking occurs when `violation_count >= 2` for any single type or `total_violations >= 2`

#### Extension side-panel detection (`extension_panel`)
Chrome side-panel extensions (Monica AI and similar "AI sidebar" extensions) render via the browser's native Side Panel API. This panel visually shrinks the page's rendered layout while `document.fullscreenElement` remains set — no `fullscreenchange` event fires, so the pre-existing fullscreen-exit detection never sees it.

**Critical, counter-intuitive measurement finding (confirmed via live testing 2026-07-21):** while fullscreen and a side panel is open, `window.innerWidth`, `window.screen.width`, and `window.outerWidth` all stay **frozen** at their pre-panel values — they do not reflect the shrink at all. Only `document.documentElement.getBoundingClientRect().width` (equivalently `document.body.clientWidth`) reflects the real layout shrink (~465px observed with Monica). An earlier implementation attempt compared `window.screen.width - window.innerWidth` and silently never triggered because of this — do not reintroduce that comparison.

Current implementation in `StudentExam.tsx`:
- A baseline `document.documentElement.getBoundingClientRect().width` is recorded in the `fullscreenchange` handler whenever `document.fullscreenElement` becomes truthy (stored in `documentWidthBaselineRef`), and re-recorded lazily by the poller if it mounts after fullscreen was already active (resume-after-reload case).
- A `setInterval` poller (`VIEWPORT_CHECK_INTERVAL_MS` = 1500ms) runs only while `started && !locked && !submitting` and `document.fullscreenElement` is set.
- Each tick compares `documentWidthBaselineRef.current - currentWidth` against `VIEWPORT_SHRINK_THRESHOLD_PX` (80px).
- The shrink must persist for `VIEWPORT_SUSTAIN_POLLS` (2) consecutive ticks (~3s) before firing `handleViolation('extension_panel')`, to avoid false positives from transient layout jitter — following the same debounce lesson as the fullscreen-exit and previously-removed devtools window-size heuristic (see comment near `StudentExam.tsx:325-327` in earlier revisions).
- No `resize`/`visualViewport.resize` event is relied on, since side-panel open/close doesn't reliably fire those in all browsers — polling is used instead.

If this detection stops working again, verify in this order before touching the logic: (1) confirm the deployed bundle actually contains the fix (see Vercel deploy note below — this bit twice), (2) re-measure `documentElement`/`innerWidth`/`screen.width` live with a throwaway static HTML page served over `http://localhost` (not `file://` — extensions don't inject into `file://` pages) since browser/extension internals can change behavior across Chrome versions.

#### Anti-Cheat v2 (added 2026-07-28)

Two new detection layers were added to handle vectors that bypass existing clipboard intercept:

**1. `suspicious_paste` — Maccy (macOS) and `Win+V` (Windows clipboard history) detection**

Maccy and Windows built-in clipboard history (`Win+V`) inject text via the OS Accessibility API, bypassing Monaco's `addCommand()` keyboard intercept entirely. The text appears in the editor as if typed, but Monaco still fires `onDidChangeModelContent` with a large `change.text.length`.

Detection in `client/src/components/CodeEditor.tsx` (`handleEditorMount`):
- Attaches `editor.onDidChangeModelContent` listener (only when prop `onSuspiciousPaste` is provided)
- Skips `isFlush: true` events (fired when value prop is set externally, e.g. resume exam load)
- **Threshold: 300 characters per single change event** (lowered from 1200 on 2026-07-29 — the old 1200 let typical Notes-copied answers of 300–800 chars slip through, which was the actual bypass being exploited)
  - **⚠️ False-positive caveat:** the larger IntelliSense snippets (`SpringController` 366, `JpaEntity` 422, `MockMvcTest` 403, `HandlerInterceptor` 546, `WebMvcConfigurer` 869, `GlobalExceptionHandler` 1093) now exceed the threshold and **would be flagged if typed**. This is currently safe **only because those snippets are not in use**. If they are re-enabled, the length-only check must be paired with a snippet exclusion (e.g. check whether the Monaco suggest widget is open at the time of the change) before keeping the 300 threshold. Snippets still safely below threshold: `psvm` (~30), `hashequals` (220).
- On trigger, passes the first 500 chars of `change.text` and the true `change.text.length` to `onSuspiciousPaste(preview, textLength)`
- 10-second cooldown to avoid duplicate reports from the same paste action
- Calls `onSuspiciousPaste(preview, length)` prop → `handleSuspiciousPaste()` in `StudentExam.tsx` → `handleViolation('suspicious_paste', { contentPreview, textLength, questionId })`
- Backend: **lockable** (as of 2026-07-29 — no longer log-only); the paste preview is stored in `violation_events.content_preview`

**2. `focus_lost` — window focus heartbeat (macOS Split View / Notes alongside exam)**

On macOS, when a student opens another app (Notes, TextEdit) alongside the browser (without entering Split View fullscreen), `document.hidden` stays `false` and `visibilitychange` does not fire. The exam appears uninterrupted from the system's perspective.

Detection in `client/src/pages/StudentExam.tsx` (rewritten 2026-07-29 — replaced the old 5s polling heartbeat):
- Listens to `window` `blur`/`focus` events (not polling) while `started && !locked && !submitting`
- On `blur`, starts a **3-second grace timer** (`focusLostTimeoutRef`); if `focus` returns before it fires, the timer is cleared and no violation is recorded
- If the timer fires and `document.hasFocus()` is still false → `handleViolation('focus_lost')`
- **Grace rationale (3s):** once fullscreen, there's no legitimate reason for window focus to leave; 3s clears the genuine noise — fullscreen transitions (~0.5s), the fullscreen permission dialog, Windows notifications (~1–2s), macOS Spotlight (~2s) — while Maccy/Notes usage always exceeds it
- **Why event-based, not polling:** a poll every 5s aliases — a short focus-loss can fall entirely between two ticks and never be seen; `blur`/`focus` measure the real duration
- Backend: **lockable** (as of 2026-07-29 — no longer log-only). `focus_lost` events carry no `content_preview` (nothing to store), only timestamp + type

**3. Dynamic watermark (same 2026-07-28 update)**

**Rapid text insertion (integrated 2026-08-10):** cumulative insertion of at least 300 characters within 2.5 seconds, where no single change reaches the existing 300-character suspicious-paste threshold, is recorded as forensic-only `rapid_text_insertion`. Detection lives in `client/src/services/rapidInsertionDetector.ts`, outside Monaco, so `CodeEditor.tsx` remains the main-branch implementation. Both `StudentExam.tsx` and `StudentPractice.tsx` must invoke it from their answer-change paths. The API forwards bounded numeric metadata into `violation_events.metadata_json`; it does not increment the lockable violation count.

Previously the forensic watermark timestamp was frozen at the time React rendered the watermark JSX (once on mount). It now uses a `watermarkTime` state that updates every 30 seconds, so screenshots taken later in the exam carry a more accurate timestamp for forensic tracing.

**4. Admin Results page — violations breakdown (2026-07-28, updated 2026-07-29)**

`GET /api/admin/batches/:id/results` returns `violations_breakdown: { [type]: count }` alongside the existing `violations` (total). `client/src/pages/Results.tsx` displays each type as an orange (🟠) badge. (The earlier blue-badge distinction for log-only types was removed on 2026-07-29 when `suspicious_paste`/`focus_lost` became lockable — every type is now a lockable violation.)

**5. Forensic `violation_events` table + paste-content popup (added 2026-07-29)**

The `violations` table is keyed by `(student_id, type)` and only stores a running count — it cannot record individual occurrences or their content. A new append-only table `violation_events` was added (created in `src/server/db/postgres.ts` for both SQLite and PostgreSQL):
- Columns: `id, student_id, batch_id, type, text_length, content_preview (VARCHAR 500), question_id, created_at`
- `POST /api/student/violation` inserts one row per report (in addition to the existing count UPDATE on `violations`), reading optional `content_preview` / `text_length` / `question_id` from the request body. `content_preview` is server-side truncated to 500 chars and is only populated for `suspicious_paste`; `focus_lost` rows store timestamp + type only.
- `GET /api/admin/batches/:id/results` returns a `violation_events` array per student.
- `client/src/pages/Results.tsx` shows a "🔍 Xem chi tiết (N)" button that opens a modal listing each event (type, timestamp, char length, question id, and the paste preview in a monospace block) — so admins can adjudicate a flag from the actual pasted text without querying the DB.
- Server-side timer guard in `GET /exam/questions`: if `exam_deadline` has passed, the server auto-submits and returns `410 Gone` with `reason: 'timeout'`
- Disconnect guard: if `disconnected_at` is set for > 120 seconds, the server auto-submits on next `GET /exam/questions` and returns `410 Gone` with `reason: 'absent_too_long'`

### Practice exams (long-form .docx exams, separate from question_bank)
A second exam mode, fully independent of the question-bank/blueprint pipeline:

- **Restored 2026-08-10 after merge `ed8b5aa` deleted the whole feature.** That merge dropped `practice_exams`/`practice_submissions`, `batches.practice_exam_id`, `ai_queue.kind`, every practice route, and `exam_kind` from `/verify` — while both frontend pages stayed wired, so `/admin/practice` and `/practice` called endpoints that no longer existed. Two latent SQLite bugs surfaced during the restore and are fixed: the `ai_queue` writes used `$N` placeholders in a shared code path (silently `RangeError` under SQLite, so no job ever persisted), and they bound `Date` objects, which better-sqlite3 rejects. Both must stay as `?` + `.toISOString()`.
- **Data model**: `practice_exams` (id, name, `content_html` from mammoth docx→HTML conversion, `content_plain` via `stripHtml()` for the AI grading prompt) and `practice_submissions` (one row per student: answer + ai/trainer score/feedback). A batch becomes a Practice batch by having `batches.practice_exam_id` set (blueprint is stored NULL for those); one batch is either blueprint-based or practice-based, never both.
- **Admin import**: `POST /api/admin/practice/import` (`src/server/routes/admin.ts`) accepts a `.docx` upload (multer memory storage) + optional name, converts with `mammoth.convertToHtml`, stores both HTML and stripped plain text. Managed in `client/src/pages/PracticeManagement.tsx` at `/admin/practice` (list/preview/delete; delete is blocked while any batch references the exam). Batch creation (`BatchManagement.tsx`) has a "Question Bank | Practice" tab — Practice mode swaps the blueprint UI for a practice-exam `<select>` and sends `practice_exam_id` instead of `blueprint`.
- **Student flow**: same access-code login. `POST /student/verify` returns `exam_kind: 'practice' | 'exam'` (derived from `batches.practice_exam_id`); `StudentConfirm.tsx` routes to `/practice` instead of `/exam` accordingly. `client/src/pages/StudentPractice.tsx` renders the docx HTML (DOMPurify-sanitized) in a left panel and a single Monaco CodeEditor (one answer for the whole exam) on the right. It intentionally duplicates the anti-cheat/timer/violation logic of `StudentExam.tsx` — changes to anti-cheat behavior must be applied to BOTH files.
- **Student API** (`src/server/routes/student.ts`): `GET /student/practice` (auto-starts on first call: sets deadline + creates the `practice_submissions` row; enforces the same 410 timeout/absent guards as `/exam/questions`), `POST /student/practice/answer` (direct DB update — no buffer, since it's a single answer, client debounces 2s), `POST /student/practice/submit`. Violations and the disconnect beacon reuse the shared `/student/violation` and `/exam/disconnect` endpoints.
- **AI grading**: `cache.addToQueue(id, studentId, 'practice')` — queue jobs carry `kind`; practice jobs JOIN `practice_submissions`+`practice_exams` and grade the whole answer against `content_plain` holistically (no rubric columns). Results written back to `practice_submissions`.
- **Trainer review**: `GET /api/admin/batches/:id/practice-results` + `PUT /api/admin/practice-results/:studentId`; `Results.tsx` detects `batch.practice_exam_id` and renders the practice results table/review panel instead of the per-question view. Excel export (`GET /api/admin/batches/:id/practice-results/export`, wired to the same "Export Excel" button) is a single sheet, one row per student (Email, Status, Violation Count, Answer, AI Score, AI Feedback, Trainer Score, Trainer Feedback) — different shape from the regular exam export (`.../results/export`, one sheet per student, one row per question), since a practice batch has one holistic answer per student rather than several graded questions.
- **Students import**: `POST /batches/:id/students/import` skips blueprint validation and question assignment entirely for practice batches (students are created with access codes only). Student reset/delete and batch delete also clean up `practice_submissions`.
- **Run code (self-check)** — "▶ Run Code" button on `/practice`, **local-first** to keep load off the t3.micro:
  - `python`/`c`/`cpp` run **in the student's browser** (`client/src/services/localRunner.ts`): Pyodide (real CPython→WASM) for Python, JSCPP (JS interpreter, C++ *subset* — fine for junior exercises, not full g++) for C/C++. Each runtime runs in a reused Web Worker loaded from CDN (first run downloads ~5-10s, warm runs are instant); infinite loops are handled by `worker.terminate()` on timeout (60s cold / 8s warm). Zero server requests for these languages.
  - `cobol`/`java` have no viable browser runtime → they still go through `POST /api/student/run` (`src/server/coderunner.ts`): gcc/g++/python3/cobc (tries `-free`, falls back to fixed-format)/javac. Resource guards: **strictly sequential FIFO queue** — 1 submission compiles/runs at a time; each job's temp dir (source + binary) is deleted **synchronously before the next job starts** (disk/RAM freed between jobs), queue holds up to 20 waiting submissions (a full class), 429 beyond that; stale `coderun-*` temp dirs from a previous crash are swept at server startup. Also: 1 run per student at a time, compile timeout 10s / run 5s with process-group SIGKILL, Linux ulimits (256MB vmem / 64 procs / 10MB files), output capped 64KB, **clean env** (`PATH` only — never `DATABASE_URL`/`JWT_SECRET`), only `in_progress` students. Set `ENABLE_SERVER_CODE_RUN=false` to hard-disable server-side execution (returns 503). NOT a hard sandbox (runs as app user) — internal training only; Docker/nsjail/Judge0 is the upgrade path. One-time EC2 install: `sudo apt install -y gnucobol default-jdk` (gcc/g++/python3 only needed if server-side C/C++/Python runs are ever re-enabled for fallback).

### Code editor language support (student answer editor)
- The Monaco-based answer editor is `client/src/components/CodeEditor.tsx`. `LANGUAGE_OPTIONS`/`SupportedLanguage` there is the single source of truth for which languages appear in the student-facing "Language:" dropdown; add new languages there.
- Monaco ships `c`, `cpp`, `python`, and `csharp` as built-in languages already (`c`/`cpp` registered by its own `basic-languages/cpp/cpp.contribution.js` under two separate ids sharing one tokenizer) — no extra registration needed for any of those four.
- Monaco has **no built-in COBOL support**. `client/src/hooks/useMonacoCobolLanguage.ts` registers a minimal custom Monarch tokenizer for it (`registerCobolLanguage()`, called once from `CodeEditor`'s `beforeMount`) — keyword list only, no IntelliSense/completions (unlike the Java completions in `useMonacoJavaCompletions.ts`). If COBOL support needs to get richer (snippets, division-aware completions), extend that file following the Java completions file as a pattern.
- `detectLanguage(questionType, questionModule)` in `CodeEditor.tsx` picks the editor's *default* language from the question's `type`/`module` text (student can still override via the dropdown) — it matches `cobol`, `python` (`python|py|django|flask|pandas`), `csharp` (`c#|csharp|.net|dotnet|asp.net`), and C/C++ via `c\+\+|cpp|embedded|mcu|isr|autosar` (falls to `cpp`) or a standalone `c` word (falls to `c`). It still defaults to `java` when nothing matches, which is a holdover from this platform's original Java-exam use case — reconsider that default if this platform is now primarily used for C/C++ embedded question banks (see `D:\Workspaces\C_CPP\...` import files referenced elsewhere in this doc).

### Frontend performance and resilience (2026-08-09)
- **Routes are code-split.** `client/src/App.tsx` loads every page through `lazy()` behind one `<Suspense fallback={<RouteFallback />}>`. Before this, all pages were static imports, so a candidate opening the exam downloaded the entire admin console in a single ~1 MB bundle. Student first load went from 375 KB to 86 KB gzip.
- **`src/App.tsx` MUST stay in the obfuscator `exclude` list** (`client/vite.config.ts`). `stringArrayThreshold: 1` encodes every string literal, including the module specifier inside `import('./pages/X')`. Rollup then cannot resolve those imports statically, silently emits **no page chunks at all**, and the build still reports success — the app 404s on the first navigation. Verified: with App.tsx obfuscated the build transforms 90 modules and emits 2 JS files; excluded, it transforms 176 and emits 25. Anti-cheat code stays obfuscated either way (the `StudentExam` chunk contains no plaintext `suspicious_paste`/`fullscreen_exit`).
- **Error boundaries exist now.** `client/src/components/ErrorBoundary.tsx` wraps the whole route tree, and `/exam` plus `/practice` get their own boundary with `reassureSavedWork` so a render crash mid-exam explains that answers are already on the server instead of showing a white screen. Keep the exam boundaries separate from the app-level one; the reassurance text is wrong for admin pages.
- **Never define a component inside another component's render.** `BatchManagement.tsx` used to declare `ValidatedInput`, `ModuleGroupSelect`, `BlueprintModeToggle`, and both stats panels inline. Each parent render produced a new component type, so React unmounted and remounted the subtree — the blueprint number inputs were destroyed after every keystroke and lost focus, forcing the admin to click back into the field. All five now live at module scope and receive what they need as props. `client/src/pages/BatchManagement.regression.test.tsx` pins the lesson by asserting both the correct and the broken shape.
- **Client dependencies must stay declared.** `JSCPP` (browser C/C++ runner) and `monaco-editor` are imported directly by `client/src` but were dropped from `client/package.json` by merge `ed8b5aa`; builds kept working only because stale `node_modules` still held them. On a clean `npm ci` — which is exactly what `deploy/scripts/deploy.sh` runs — `npm run build:client` fails with "Rollup failed to resolve import \"JSCPP\"". Both are declared again. When a merge touches `client/package.json`, re-run a clean install before trusting a green build.
- **Client test tooling is a real dependency, not scaffolding.** Vitest, jsdom and the Testing Library packages were dropped by the same merge while the test files stayed, so `npm test` silently disappeared. They are declared again alongside the `test` / `test:watch` scripts.
- **Client tests run on Vitest + React Testing Library**: `cd client && npm test` (config in `client/vitest.config.ts`, jsdom, setup at `src/test/setup.ts`). This is separate from the server's `node --test` suite (`npm run test:tenant`).

### Two independent deployment methods — keep both, don't mix them
This repo intentionally supports **two separate, independent deployment paths**. Neither depends on the other, and a change to one should not assume it applies to the other:

1. **Vercel** (`vercel.json`) — builds `dist/server/index.js` (`@vercel/node`) and serves static assets from `client/dist/**`, with `public/` referenced as the html/asset fallback path in some historical setups. This path is defined and kept in the repo for whoever/whenever Vercel is the target, but is **not what currently serves `epoc.devfasttrack.com`**.
2. **Self-hosted EC2 + nginx + pm2, via `deploy/scripts/deploy.sh`** — this is the method actually used for `epoc.devfasttrack.com` today, and it **does not use Vercel in any way**: no `vercel.json` step runs, no Vercel CLI/API is involved, nothing is deployed to Vercel's infrastructure. Building "via deploy.sh" means: SSH/EC2-console into the instance, `git pull`, rebuild `dist/` and `client/dist/` locally on that same box with plain `npm run build:*`, and restart via `pm2`. See below for the full flow.

When troubleshooting "why doesn't my change show up," first confirm **which of the two** environments you're actually looking at (their URLs differ) — don't assume Vercel-style behavior (auto-deploy on push, `public/` as the served path) applies to the EC2/deploy.sh target, and vice versa.

### Static runtime path
- There are three frontend runtime modes that have existed in this repo's history:
  - Vite dev mode from `client/src/**` (`npm run dev` in `client/`)
  - `public/index.html` + `public/assets/**` — the path referenced by the Vercel deployment method (see above). Not used by the EC2/deploy.sh deployment.
  - `client/dist/**` — built by both deployment methods, but only the EC2/deploy.sh method serves it directly (via nginx); Vercel's `vercel.json` also serves `client/dist/**` for static assets, so this path is actually shared by both.
- For behavior changes in `StudentExam.tsx`, always confirm which runtime is actually being served before concluding a fix works. If you're testing against the EC2 deployment specifically, that means `client/dist/` (rebuilt by `deploy/scripts/deploy.sh` on the server itself, not by syncing artifacts from a dev machine) — `public/` syncing is irrelevant there. If you're testing against a Vercel deployment, `public/` may matter; check `vercel.json`'s routes.

### Legacy `terraform-ipv6` bootstrap (fixed 2026-08-11)
- New tenants use `terraform/tenant-instance`. `terraform-ipv6` remains only because the current FSA-CLS production instance was provisioned from it; the notes below describe that live path.
- **Editing `userdata.sh` alone changes nothing on a running instance.** cloud-init executes user-data only on a instance's first boot, and `aws_instance.user_data_replace_on_change` defaults to `false`, so `terraform apply` just rewrites the attribute in state. The module now sets it to `true`, which means an edit **replaces** the instance (terminate + recreate). To re-run the script on the existing box instead, execute `/var/lib/cloud/instance/scripts/part-001` there.
- **Bootstrap must create the other two databases.** RDS provisions only `var.db_name`, while `.env` declares `DATABASE_URL`, `CONTROL_DATABASE_URL` and `LOG_DATABASE_URL`; production startup fails when a plane is missing. `userdata.sh` therefore runs `npm ci --include=dev` → `npm run deps:verify` → `npm run build:server` → `npm run db:ensure` → `npm run db:migrate` before starting PM2. Without those two database steps PM2 starts and the app exits immediately — the instance looks healthy while the site is unreachable.
- **`.env` sinh bởi bootstrap phải có `JWT_SECRET`.** `src/server/index.ts` gọi `process.exit(1)` ngay khi thiếu, nên bỏ sót khóa này khiến PM2 khởi động rồi app chết ngay — nhìn giống hệt lỗi thiếu database. `jwt_secret` là biến Terraform bắt buộc (không default, validate >= 32 ký tự); đặt giá trị thật trong `terraform.tfvars` (đã gitignore), không commit vào repo. `DATABASE_MAINTENANCE_DB` cũng được ghi ra để `db:ensure` không phải đoán.
- **`.env` sinh bởi bootstrap phải mang cả tài khoản seed.** `SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD` và `FSA_TENANT_ADMIN_USERNAME`/`FSA_TENANT_ADMIN_PASSWORD` được truyền từ `terraform.tfvars`. Thiếu chúng thì ứng dụng rơi về mặc định nằm sẵn trong source và trong lịch sử git, nghĩa là máy production chạy một quãng bằng mật khẩu ai clone repo cũng đọc được. Hai mật khẩu là biến bắt buộc (không default, validate >= 12 ký tự) nên `plan` dừng ngay thay vì âm thầm dùng mặc định. **Chỉ có tác dụng với database mới:** trên database đã có tài khoản, `seedSuperAdmin()` và `seedFsaTenantAdmin()` cố ý không ghi đè, nên đổi biến rồi apply lại không đổi được mật khẩu đang dùng — phải đổi qua API đổi mật khẩu.
- Heredoc tạo `.env` dùng dấu nháy (`<< 'ENVEOF'`) để bash không diễn giải `$`/backtick trong giá trị bí mật; Terraform vẫn thay biến template vì nó xử lý trước khi script chạy.
- **user-data phải nén.** AWS giới hạn `user_data` ở 16384 byte và script bootstrap đã vượt (comment UTF-8 tiếng Việt tốn nhiều byte). Module dùng `user_data_base64 = base64gzip(templatefile(...))`; cloud-init tự nhận diện và giải nén. Sau khi nén còn ~7,9 KB.
- **Mật khẩu database phải `urlencode()` khi ghép vào connection URL.** Mật khẩu production chứa `#`, khiến `postgresql://user:pass#...@host/db` không phân tích được — mọi thứ sau `#` bị coi là fragment nên cả ba plane mất kết nối. `pg-connection-string` tự giải mã percent-encoding nên giá trị nhận được vẫn đúng nguyên bản.
- **Connection URL phải dùng `sslmode=no-verify`, không phải `require`.** `pg` bản mới coi `require` là bí danh của `verify-full`, và tham số SSL lấy từ chuỗi kết nối **ghi đè** tùy chọn `ssl` truyền trong code — nên `ssl: { rejectUnauthorized: false }` ở `databaseBootstrap.ts` và ba pool của ứng dụng đều bị vô hiệu, Node đòi xác minh CA của RDS và ném `SELF_SIGNED_CERT_IN_CHAIN`. Triệu chứng rất dễ đọc nhầm: `db:ensure` báo `Check connectivity and CREATEDB privilege` (không kèm SQLSTATE, vì đây không phải lỗi Postgres) trong khi `psql` cùng URL vẫn kết nối bình thường. Muốn xác minh thật thì phải nạp bundle CA của RDS và chuyển cả ba pool sang `verify-full` cùng lúc — đổi riêng URL sẽ hỏng lại y hệt.
- **`no-verify` là quy ước của node-postgres; libpq không hiểu nó.** `psql`/`pg_dump` chỉ nhận `disable|allow|prefer|require|verify-ca|verify-full`. Mọi script shell đọc `DATABASE_URL` từ `.env` phải đổi `no-verify` thành `require` trước khi truyền cho công cụ libpq (`backup-db.sh` làm đúng như vậy).
- **Sửa `userdata.sh` là thay instance, và IPv6 đổi theo.** `user_data_replace_on_change = true` khiến `apply` terminate máy cũ; module không tạo bản ghi DNS nào (không có resource Route53), TLS kết thúc ở Cloudflare còn nginx chỉ `listen 80`. Bản ghi AAAA trong Cloudflare vì thế trỏ vào máy đã chết và site trả **522** — lỗi trông giống hệt "bootstrap hỏng" dù máy mới hoàn toàn khỏe. Sau mỗi lần thay instance phải cập nhật AAAA; hoặc vá tại chỗ qua SSM để giữ nguyên địa chỉ.
- **Chẩn đoán bootstrap qua SSM, không cần SSH.** `aws ssm send-command` với `AWS-RunShellScript` đọc được `/var/log/userdata.failed` và `/var/log/userdata.log`. Output tiếng Việt làm AWS CLI trên Windows chết với `charmap codec can't encode` — bọc lệnh trong `{ ...; } | base64 -w0` rồi giải mã ở máy local.
- `POST /api/init-tables` no longer exists; schema creation belongs to `db:migrate`.
- Root volume is 16 GiB. At 8 GiB the two `node_modules` trees plus build output filled the disk (~222 MB free observed), which kills `npm ci` midway and leaves a broken install.
- `userdata.sh` runs under `set -euo pipefail` with an `ERR` trap that logs the failing line and writes `/var/log/userdata.failed`. When the boot log looks truncated, check that file first — a bare `set -e` abort prints nothing.

### EC2 + nginx + pm2 deployment (`deploy/scripts/deploy.sh`)
- Production at `epoc.devfasttrack.com` (at the time of writing) runs on a self-hosted EC2 instance — accessed via the AWS EC2 console (EC2 Instance Connect / Session Manager), not a persistent SSH key setup.
- Deploy flow: `deploy/scripts/deploy.sh`, run from `/opt/eaudit/app` on the instance. A root-run deploy first installs canonical `/opt/eaudit/.env` into the app directory with mode `600`, then drops to the PM2 owner. It refuses tracked local changes, fast-forwards `main`, rejects Node.js older than 22 before dependency installation, runs deterministic root install plus `npm run deps:verify`, builds the backend, runs `npm run db:ensure`, migrates assessment/control/log through `npm run db:migrate`, builds the frontend, and only then replaces PM2 with `dist/server/server.js`. It fails on runtime, dependency, migration, or origin-health checks and prints bounded diagnostics. It does **not** touch `public/`, and does **not** invoke Vercel in any way.
- nginx config: `deploy/nginx/eaudit.conf`. `/api/*` reverse-proxies to `http://127.0.0.1:3001` (the pm2-managed Node process); everything else is served as static files from `/opt/eaudit/app/client/dist` with SPA fallback (`try_files $uri $uri/ /index.html`).
- DB is Postgres via RDS (all three URLs are set in canonical `/opt/eaudit/.env`, not committed to the repo) — so `USE_SQLITE` is `false` on this deployment; the SQLite code paths only run in local dev. One RDS instance may host the planes, but `DATABASE_URL`, `CONTROL_DATABASE_URL`, and `LOG_DATABASE_URL` must use distinct database names. Bootstrap creates only absent databases; deploy migrates all three schemas explicitly, and normal startup repeats idempotent initialization as a safety check.
- **Pushing to `origin/main` does not deploy anything by itself on this path.** There is no CI/CD webhook wired up as of this writing — someone must manually re-run `deploy/scripts/deploy.sh` on the EC2 instance after a push for the change to go live. If a fix "isn't showing up," the first thing to check is whether `deploy.sh` was actually re-run after the relevant commit landed on `main` — e.g. `cd /opt/eaudit/app && git log -1 --oneline` on the instance, compared against the latest commit that should be live.
- Practical corollary seen in this repo's history: a question-bank import can appear to "not save a field" when the real cause is that the import ran against still-deployed old code (before a deploy), writing an empty value for a newer column, and simply needs to be **re-imported** after the deploy actually lands — re-importing the same file goes through the `ON CONFLICT DO UPDATE` / `INSERT OR REPLACE` path and overwrites the stale empty value correctly (verified: this is not a query bug, `db.query()`'s handling of `question_group` is correct in both DB modes).
#### Screen recording — three modes: `none` / `local` / `s3` (per-batch `record_mode`)

The exam can record the candidate's full screen. Since 2026-07-30 the per-batch setting is a **3-value `record_mode`** (`batches.record_mode`, replacing the old boolean `record_enabled` — admin-only, see Admin roles):

- **`none`** — no recording. `StudentConfirm` skips screen-share entirely; `StudentExam` skips the `recording_stopped` handler and resume-after-reload guard.
- **`s3`** — records and uploads **directly to AWS S3** via presigned PUT URLs during the exam (details below). The video never resides on the candidate's machine.
- **`local`** — records to a folder the candidate picks (File System Access `showDirectoryPicker`); each part is **compressed + AES-256 encrypted into a `.zip` client-side** with a password the **server generates and stores, never shown to the candidate**. Candidate commits the zip folder to GitLab after the exam; an admin retrieves the password to decrypt. See the "`local` mode" subsection below. **Security caveat:** this revives (in a hardened form) the very "save-local + candidate-commits" model that S3 replaced — the candidate still controls the evidence file (can fail to commit / commit a corrupt file), and because the client must receive the password to encrypt, a technical candidate can in principle read it from the `/verify` response. `local` only limits leak damage per-batch; it does not close the hole the way `s3` does. Prefer `s3` when leak-resistance matters.

**Flow of the setting:** `/verify` returns `record_mode` (and, for `local`, `recording_password`); it flows login → `/confirm` (router state) → `localStorage.recordMode` (+ `localStorage.recordingPassword` for local) → `/exam`. `StudentExam` derives `recordEnabled = recordMode !== 'none'` so all existing recording guards keep working for both `local` and `s3`. The `POST /exam/recording-url` endpoint **rechecks `batches.record_mode === 's3'` server-side** (returns 403 otherwise), so S3 URLs cannot be obtained for `local`/`none` batches. `record_enabled` is still written (`= record_mode === 's3'`) for backward compat but `record_mode` is authoritative.

**S3 mode** (`record_mode === 's3'`): the video uploads **directly to AWS S3** during the exam (via presigned PUT URLs). The video never resides on the candidate's machine.

Architecture (presigned URL — sidesteps Vercel serverless payload/timeout limits, since the video goes client→S3, not through the backend):
```
Client records → every 5 min cuts a part → asks backend for a presigned PUT URL
  → PUTs the blob straight to S3 → retry-queue on failure (does not block the exam)
S3 key: recordings/{batchId}/{studentId}/part{NNN}.webm  (batchId/studentId from JWT, not client)
Deletion: S3 Lifecycle rule auto-expires objects after N days (no backend script)
```

- **Backend:** `POST /api/student/exam/recording-url` (`studentAuthMiddleware`) returns a presigned PUT URL from `src/server/services/s3.ts` (`createRecordingUploadUrl`). AWS credentials live only in backend env; the URL expires in 15 min. The S3 key is built from `batchId`/`studentId` in the JWT so a candidate cannot overwrite another's video. Returns `503` if S3 env is not configured (`isS3Configured()`).
- **Frontend module** `client/src/services/examRecorder.ts` (singleton **outside React** — survives the `/confirm` → `/exam` navigation; handles **both** `s3` and `local` modes):
  - **Full-screen only:** `getDisplayMedia({ video: { displaySurface: 'monitor' } })`; a shared tab/window (`displaySurface !== 'monitor'`) is refused. Requires **Chrome/Edge + HTTPS**; Safari/Firefox blocked at confirm.
  - **Config:** VP9 (fallback VP8), 5 fps, ~600 kbps → ~22 MB per **5-minute part**. In `s3` mode each part asks for a presigned URL then `fetch(url, { method: 'PUT', body: blob })` straight to S3, with a **retry queue** (exponential backoff, max 5 attempts) in the background. In `local` mode each part is zipped+encrypted and written to the chosen folder.
  - **Mode-aware API:** `isSupported(mode)` (local also needs `showDirectoryPicker`), `requestSetup(mode)` (local also prompts the folder picker **before** `getDisplayMedia`, both inside the click gesture), `start({ mode, password })`. `flushPart()` routes to S3 upload or local zip by mode.
- **Lifecycle:** `requestSetup(recordMode)` is called in `StudentConfirm.tsx#handleStartExam` **in the click gesture, BEFORE `requestFullscreen()`** (fullscreen consumes the user-activation that `getDisplayMedia`/`showDirectoryPicker` need — order matters). `start({ mode, password })` begins recording. `stopAndSave()` at the top of `handleSubmit` in `StudentExam.tsx` covers all three submit paths (manual / cheating auto-submit / timeout); wrapped in try/catch so a recording error never blocks submission. For `local`, `stopAndSave()` **awaits** the final zip write.
- **`recording_stopped` violation:** `track.onended` (candidate clicks "Stop sharing") → `handleViolation('recording_stopped')`. Backend locks on the **first** occurrence (`type === 'recording_stopped'` short-circuits the `>= 2` rule in `student.ts`). Registered via `examRecorder.setOnRecordingStopped()` after `/exam` mounts; if the track already ended before registration, the callback fires immediately. Applies to both `local` and `s3`.
- **Resume-after-reload:** F5 resets the singleton, so if the candidate re-enters `/exam` while running but `examRecorder.isActive()` is false, a blocking modal (`handleResumeRecording`) forces them to re-share the screen. For `local`, the `dirHandle` does **not** survive F5, so the candidate must re-pick the folder; the password is re-read from `localStorage.recordingPassword` (same value the server issued, so pre- and post-reload zip parts share one password).
- **Env required for `s3` (set on Vercel):** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_RECORDINGS_BUCKET`. The bucket needs a **CORS policy** allowing `PUT` from the deployment origin and a **Lifecycle rule** to auto-delete. IAM user should be scoped to `PutObject` on `recordings/*` only. `local` mode needs none of these.
- **macOS caveat:** the first `getDisplayMedia` requires granting Screen Recording permission to Chrome in System Settings **and restarting Chrome**. Because exams are time-gated, candidates should do this during a **practice exam** beforehand, not on exam day.

##### `local` mode specifics (added 2026-07-30)
- **Client-side zip encryption:** `client/src/services/examRecorder.ts` uses **`@zip.js/zip.js`** (`ZipWriter` with `password`, `encryptionStrength: 3` = AES-256, `level: 0` — no recompression since webm is already compressed). Each 5-min part becomes `exam_{stamp}_part{NNN}.zip` written to the folder via File System Access API.
- **Password provenance:** `POST /api/student/verify` generates `crypto.randomBytes(24).toString('base64url')` **once per `students` row** and stores it in `students.recording_password` (reused on subsequent `/verify` calls for that row, so resume uses the same password). It is returned to the client **only for `local` mode** (needed to encrypt) and **never displayed to the candidate**.
- **Password scope:** keyed by `students.id`, and since a `students` row is one **(person × batch)**, the same person in different batches gets **different** passwords; all zip parts of one exam attempt share **one** password.
- **Admin retrieval:** the password is surfaced on the **Results page** (`Results.tsx`) next to each student (`r.student.recording_password`, admin-only) so an admin can decrypt the GitLab-committed zip. It rides along in the `/batches/:id/results` payload via `SELECT s.*`.
- **DB columns:** `batches.record_mode` (VARCHAR(16)/TEXT default `'none'`) and `students.recording_password` (TEXT), created + migrated in `src/server/db/postgres.ts` for both Postgres and SQLite. Migration backfills `record_mode='s3'` where the old `record_enabled` was true. **Deploy note (Vercel + Supabase):** these `ALTER TABLE`s run automatically at DB init on cold-start (idempotent, `IF NOT EXISTS` + try/catch), but to avoid a race on the first few requests after deploy, prefer running them manually in the Supabase SQL Editor **before** deploying.

### Question identity: the (id, question_group) pair (restored 2026-08-10)
- **A question is identified by the PAIR `(id, question_group)`, never by `id` alone.** Real question sets reuse IDs: `QB_Output_CPP_EMB_PRINT_IOT_ch6-10.xlsx` and `QB_Output_CPP_EMB_AUTOSAR_ch6-10.xlsx` share **all 100** IDs (`CH6-E-01` … `CH10-H-18`). With `id` as the sole primary key, importing the second file `UPDATE`s all 100 rows of the first and destroys it silently.
- This fix **has already been reverted once** by merge `ed8b5aa`, and the data-loss bug came back exactly as before. `src/server/services/questionIdentity.test.ts` now reads the source and fails if any piece is removed again — treat a failure there as "the overwrite bug is back", not as a stale test.
- Pieces that must stay together:
  - `question_bank` primary key is `(id, question_group)`; `question_group` is `NOT NULL DEFAULT ''`. Postgres swaps the PK constraint; SQLite cannot `ALTER` a PK so `postgres.ts` **rebuilds the table**. Both check the current PK first and are idempotent.
  - Both import routes read the Excel `QuestionGroup` column (aliases `Question Set`, `Bộ đề`) and upsert with `ON CONFLICT (id, question_group)` / `INSERT OR REPLACE` including the group. Their "already exists?" probe filters on both columns and uses `?` placeholders — a `$1` there crashes under SQLite.
  - `exam_questions` carries `question_group`, written when questions are assigned. **Every join must match both columns**: `JOIN question_bank q ON eq.question_id = q.id AND COALESCE(eq.question_group,'') = COALESCE(q.question_group,'')`. There are 6 (`src/ai/queue.ts`, `cache.ts`, `admin.ts` ×2, `student.ts` ×2). Joining on `question_id` alone **doubles** the rows when two sets share an ID, so a student's exam repeats questions and AI grading picks an arbitrary set's rubric.
  - Deletes take the group: `DELETE /questions/:id?group=…`; bulk-delete accepts `"id|||group"` keys (a plain id still means "all groups", for older clients).
- `question_plain` (HTML-stripped, generated at import via `stripHtml()`) was deleted by the same merge and is restored. It is **not user-supplied** — always recomputed from `question_sample`. Use it everywhere the text is consumed by something other than the student-facing renderer: the AI grading prompt (`cache.ts` uses `q.question_plain` with a `stripHtml(question_sample)` fallback for rows imported before the column existed) and the Question Bank table. Feeding raw `question_sample` to the model makes it read `<p>`/`<strong>` markup as if it were part of the question.
- `GET /api/admin/questions/question-groups` returns the distinct non-empty groups; `QuestionBank.tsx` uses it for a "Bộ đề" column plus an independent filter that combines with the Module and Type filters. Without that column the table is genuinely ambiguous — two rows can show the same ID.
- `scripts/check-question-bank.ts` (read-only) reports per-group counts and diffs the DB against the source workbooks: `npx tsx scripts/check-question-bank.ts "A.xlsx" "B.xlsx"`.
- Related invariant, also reverted by the same merge and restored: the SQLite branch of `query()` must run `.all()` when the statement contains `RETURNING`. Through `.run()` it returns `rows: []`, so `students/import` reads `undefined` for the new student id, hits `if (!studentId) continue`, and creates students **with zero questions assigned**. Postgres never showed the bug.

### Per-tenant recording policy (2026-08-10)
- Recording now has **two layers**. `tenants.allowed_record_modes` (control-plane, superadmin, comma list such as `none,local,s3`) says which modes a tenant *may* use; `batches.record_mode` (data-plane, tenant_admin) says which one a given exam *does* use. A batch may only pick from its tenant's list.
- `src/server/services/recordingPolicy.ts` holds the pure logic (`parseAllowedRecordModes`, `serializeAllowedRecordModes`, `resolveBatchRecordMode`) and is unit-tested without a database. A rejected mode never silently upgrades: on create it falls back to `none`, on update it keeps the value already stored, and the route answers `403`.
- The allowlist reaches data-plane routes through `authMiddleware`, which already reloads the tenant row per request — `req.adminUser.allowedRecordModes`. Do **not** query `tenants` from `admin.ts`; that would cross the control/data-plane boundary.
- **Migration deliberately backfills existing tenants to `none,local,s3`** while the column default for new tenants is `none`. Tightening existing rows on upgrade would silently disable recording for batches already configured for it.
- Role rule corrected: only `tenant_admin` may change `record_mode`. The code previously tested `role === 'admin'`, which blocked the *more* privileged `tenant_admin` while allowing plain admins — the opposite of the documented policy.
- **Reviewing S3 recordings now exists.** `GET /api/admin/batches/:id/students/:studentId/recordings` returns each part plus a presigned GET URL (5-minute expiry, shorter than the 15-minute upload URL) and `Results.tsx` plays them inline. Object keys come from `recording_parts`, never from the client, and the route verifies the student belongs to the batch before signing anything. Before this, parts were tracked but there was no way to watch the evidence.
- `local` mode gets explicit hand-off instructions on the submit page (`StudentSubmit.tsx`), gated on `recordMode` read **before** the page's `localStorage.clear()` runs. Without those steps the candidate keeps the only copy of the evidence.
- `GET /api/admin/recording-config` tells the batch form which options to show. It is UX only — the backend check is authoritative.

### Queue / AI grading
- Queue and answer-buffer orchestration live in `src/server/cache.ts`
- AI evaluation provider settings are also read there (`ai_settings` plus env fallback)
- The server initializes DB, cache, and queue processing on startup in `src/server/index.ts`
- The AI grading prompt (built in `src/server/cache.ts`, inside the queue-processing job) uses `eq.question_plain` (falling back to `stripHtml(eq.question_sample)` for rows imported before this column existed) — never the raw HTML `question_sample`. Rubric fields (`rubric_must_have`/`rubric_nice_to_have`/`rubric_optional`) are still passed as-is (not HTML-stripped); they are expected to be entered as plain text via the Excel rubric columns.

### Question bank: groups and HTML-safe plain text
- A question is identified by `(id, question_group)`, not `id` alone. Preserve the composite primary key and include both columns in import upserts, existence checks, deletes, exam assignment, and every `exam_questions` → `question_bank` join.
- `question_group` is `NOT NULL DEFAULT ''`. SQLite migrates the primary key by rebuilding the table; PostgreSQL replaces the primary-key constraint. Both paths must remain idempotent.
- Delete one grouped question through `DELETE /questions/:id?group=<group>`; bulk-delete uses `id|||group` keys. A plain id remains backward-compatible and means all groups.
- `scripts/check-question-bank.ts` compares database groups/counts with source workbooks and is the preferred read-only integrity check after import changes.
- Import happens via `POST /api/admin/questions/import` in `src/server/routes/admin.ts`, parsing an uploaded `.xlsx`/`.xls` with `xlsx`.
- Quiz questions use the separate `POST /api/admin/questions/quiz/import` route and the same `(id, question_group)` identity.
- Excel header column for question group: `QuestionGroup` (aliases also accepted: `Question Set`, `Bộ đề`). If absent/blank, `question_group` is stored as an empty string.
- `question_plain` is always (re)computed at import time from `question_sample` via `stripHtml()` in `src/utils/string.ts` — it is not user-supplied. `stripHtml()` converts block-level tags (`<br>`, `</p>`, `</li>`, `</tr>`, headings) to newlines, list items to `- ` prefixes, strips all remaining tags, and decodes a small set of HTML entities (`&nbsp;`, `&amp;`, etc.).
- Frontend: `client/src/pages/QuestionBank.tsx` shows a "Question Group" column and an independent filter dropdown (combinable with the Module filter). Distinct values come from `GET /api/admin/questions/question-groups`.
- Student-facing rendering of `question_sample` (in `client/src/pages/StudentExam.tsx`) uses `DOMPurify.sanitize(...)` before `dangerouslySetInnerHTML` — this is a separate, independent safeguard from `question_plain` and must be kept even though `question_plain` now exists.
- `client/src/pages/Results.tsx` (trainer manual-review view) still renders `q.question_sample` as plain JSX text (React-escaped, so HTML tags show up literally to the trainer) — this was not changed and is a known display quirk, not a security issue, since it isn't `dangerouslySetInnerHTML`.

### Module + question group disambiguation in exam blueprints
- The same `module` name can exist under multiple `question_group`s (e.g. "Chapter 10: Unit Testing" imported once under `CPP_EMB_PRINT_IOT` and once under `CPP_EMB_AUTOSAR`). `module` alone is therefore not a unique selector for blueprint/exam purposes — every blueprint item now carries both `module` and `question_group`.
- Backend endpoints for this (`src/server/routes/admin.ts`):
  - `GET /questions/module-groups` — distinct `{ module, question_group }` combos, used to populate Module dropdowns.
  - `GET /questions/module-group-stats` / `GET /questions/module-group-type-stats` — per-(module, question_group[, type]) counts by level, used to compute per-row "Có sẵn" availability and to validate blueprint rows.
  - `POST /batches/:id/check-feasibility` and the question-picking logic inside `POST /batches/:id/students/import` both filter by `question_group` when a blueprint item specifies one (case-insensitive, via `LOWER(question_group) = ?`); omitting `question_group` on an item (legacy blueprints) falls back to matching on `module` alone.
  - Question-picking for `students/import` is centralized in the `pickQuestionIds()` helper in `admin.ts` (replaces what used to be 6 near-duplicated inline query blocks for module/type/level combinations) — extend that helper rather than re-duplicating query blocks if new selection dimensions are added.
- Frontend (`client/src/pages/BatchManagement.tsx`): Module `<select>` dropdowns (both "By Module" and "By Module + Type" blueprint modes, in both the Create and Edit batch forms) render **combo options** built from `moduleGroups`, labeled `"<module> (<question_group>)"` (or just `<module>` when there is no group). The combo is encoded as a single option value via `comboKey()`/`decodeComboKey()` (`` `${module}|||${question_group}` ``) since a native `<select>` can only carry one string value per option. Stats/availability lookups (`getStatsForModuleGroup`, `getStatsForModuleGroupType`) and blueprint validation are keyed on the `(module, question_group)` pair, not `module` alone — this matters because two combos can share a module name with different available question counts.
- Legacy batches saved before `question_group` existed are handled in `handleEditBatch()`: blueprint items loaded from the DB are defaulted to `question_group: ''` so the combo dropdowns always have a matching option to select.
- `client/src/services/api.ts` exposes `getModuleGroups`, `getModuleGroupStats`, `getModuleGroupTypeStats` for this. The older `getModules`/`getModuleStats`/`getModuleTypeStats` (module-only, no group) are still used by `QuestionBank.tsx`'s simpler Module filter dropdown, which is a plain list/filter UI, not a blueprint-authoring UI, so it does not need combo disambiguation.

### Module + question group disambiguation in exam blueprints (restored 2026-08-10)
- The same `module` name can exist under several `question_group`s, so **`module` alone is not a valid selector for a blueprint**. Picking by module only silently mixes questions from every set that shares the name.
- Backend: `GET /questions/module-groups`, `/questions/module-group-stats`, `/questions/module-group-type-stats` expose the distinct pairs and their per-level counts. Question picking runs through the single `pickQuestions()` helper in `admin.ts` (it replaced six near-identical inline query blocks) which adds `LOWER(COALESCE(question_group,'')) = ?` whenever the blueprint item names a group. Items without a group keep the old module-only behaviour, so blueprints saved before this existed still work.
- `BlueprintItem` carries an optional `question_group` on both the server (`services/blueprint.ts`) and the client.
- Frontend: a native `<select>` holds one string per option, so the module dropdowns encode the pair with `comboKey()`/`decodeComboKey()` (`` `${module}|||${group}` ``) and label it `module (group)`. Availability counts are looked up per pair — two combos sharing a module name genuinely have different counts. When an older batch is opened for editing, `handleEditBatch()` maps items with no group onto the first combo with the same module, otherwise the dropdown would show a value that matches no option.

### Export filenames
- `GET /api/admin/batches/:id/students/export` and `GET /api/admin/batches/:id/results/export` (in `src/server/routes/admin.ts`) derive the downloaded filename from the batch's `name` (looked up via `SELECT name FROM batches WHERE id = ?`), not from the batch id. Filenames are `<sanitized-batch-name>-students.xlsx` / `<sanitized-batch-name>-results.xlsx`; if the batch has no name, it falls back to `batch-<id>`.
- Filename sanitization/encoding helpers live in `src/utils/string.ts`:
  - `sanitizeFilename()` strips filesystem-unsafe characters and collapses whitespace to `_`.
  - `buildContentDisposition()` emits both an ASCII-diacritics-stripped `filename=` fallback and a full UTF-8 `filename*=` (RFC 5987) value, so Vietnamese batch names with diacritics survive the download with the correct display name in modern browsers while still degrading gracefully elsewhere.
- When testing these endpoints manually from a shell, be aware that passing non-ASCII batch names as inline `curl -d '...'` command-line arguments can get mangled by the shell/terminal encoding (observed on Windows Git Bash) before the request ever reaches the server — this is a testing-tool artifact, not an application bug. Write the JSON payload to a UTF-8 file and use `curl --data-binary @file.json` instead when verifying Unicode behavior.
- Supported AI providers: `gemini`, `openai`, `azure`, `deepseek`, `groq`, `openrouter`, `ollama`
- AI API keys are stored in the `ai_settings` table in the database

### Blueprint modes
Batches support two blueprint formats for question assignment:
- **Legacy (array)**: `[{ module, easy, medium, hard }]` — select by module only
- **New (object)**: `{ blueprintMode: 'module' | 'type', items: [...] }` — `'type'` mode selects by module + question type
- `parseBlueprintCompat()` in `admin.ts` normalizes both formats

### Quiz exams
- `batches.exam_type` is `essay` or `quiz`. Essay batches allow up to 20 questions; quiz batches allow up to 100.
- Quiz import is separate from essay import: `POST /api/admin/questions/quiz/import`. Supported question types are `SingleChoice` and `MultipleChoice`, with JSON-backed `options`, `correct_answers`, and per-question `score`.
- Quiz and essay selection are separated server-side even when one module contains both types.
- Question order is randomized per student. Quiz option order is also randomized and persisted in `exam_questions.option_order`, so reload/resume retains the same order.
- `GET /api/student/exam/questions` never returns `correct_answers`.
- On submit or server auto-submit, quiz answers are scored synchronously by exact normalized answer-set equality and bypass the AI queue. Essay/coding answers are queued for AI grading.

### Multi-tenant control plane
- Global routes are mounted at `/api/tenants` and all require `authMiddleware` plus `requireSuperAdmin` before any control-plane query.
- Superadmin can list/create all tenants, create the first tenant administrator, approve/suspend, view jobs, run Terraform plan, and apply a reviewed plan.
- Tenant admins cannot call the global tenant API. Their scope is the assessment/audit application under `/admin/*` and current-tenant user management.
- Tenant configuration includes name/contact, region, EC2 type, root volume, domain/Route53, repository/ref, secret ARN, compiler toggle/limits, provisioning outputs, error/status, and audit metadata.
- Every non-FSA tenant domain is derived from its trusted slug as `epoc.<tenant-label>.devfasttrack.com`. FSA-CLS temporarily remains at `https://epoc.devfasttrack.com/`. Backend approval/provisioning validates the exact slug/domain mapping and exception; Terraform validates the allowed formats.
- Approval, plan, and apply are separate transitions. Apply requires a successful plan created after the latest approval. Only one queued/running job per tenant is allowed.
- Terraform execution is disabled unless `TENANT_PROVISIONING_ENABLED=true`, runs only from a persistent trusted host, redacts logs, caps retained output, and uses isolated remote state key `tenants/<slug>/terraform.tfstate` with S3 encryption and DynamoDB locking.
- The supported module is `terraform/tenant-instance`, not legacy `terraform-ipv6`. It creates a dedicated dual-stack VPC, AWS-generated IPv6 `/56`, public subnet, public IPv6, Elastic IPv4 fallback, HTTP/HTTPS security group, SSM administration, least-privilege secret access, A/AAAA records when a Route53 zone is supplied, and optional tenant Lambda compiler.
- Each provisioned tenant secret must provide `DATABASE_URL` for that tenant's assessment data, `CONTROL_DATABASE_URL` for global identity/configuration, and `LOG_DATABASE_URL` for that tenant's operational issues. Keep all three in the cloud-init allowlist without logging their values.
- Only the control-plane host may receive the explicit `CONTROL_PLANE_LOG_SECRET_ARNS` IAM allowlist used for remote log observation. Ordinary tenant instances keep access to their own secret only. The control-plane host also needs network reachability to each allowed tenant log database.
- The UI at `/tenants` shows tenant status, configuration, IPv6/IPv4, DNS/app URL, compiler, state key, Terraform job history/logs, and selected-tenant operational logs. There is intentionally no destroy button.

### Tenant operational issue logs
- `src/server/middleware/issueLogger.ts` appends HTTP 4xx/5xx outcomes to the current tenant log database after the response finishes. `/api/tenants` and authenticated superadmin traffic are excluded.
- `GET /api/admin/issues` lists only rows whose `tenant_slug` equals the JWT/current server tenant. Matching `admin` and `tenant_admin` may read; only `tenant_admin` may call `PUT /api/admin/issues/:id/status` or the compatibility `PUT /api/admin/issues/:id/resolve`.
- Tenant log lifecycle is `open`, `resolved`, or `archived`. Tenant admins may resolve, reopen, archive, and restore only their own tenant rows. Archive is a soft delete: immutable event content remains, while `archived_by`, `archived_at`, `last_managed_by`, and `last_managed_at` record ownership. There is no content-edit or physical-delete API.
- `GET /api/tenants/:id/issues` is a separate superadmin-only, read-only observation path. The tenant id resolves slug/region/secret ARN from the control database; the client never supplies a slug or database URL. Current-tenant reads reuse initialized `logPlane.ts`; remote reads retrieve `LOG_DATABASE_URL` transiently from the tenant secret, use a one-connection PostgreSQL pool, scope by trusted `tenant_slug`, close it after the request, and record `tenant.logs_viewed` in the control audit table.
- Remote log errors must be sanitized. Never return or log the secret payload, `LOG_DATABASE_URL`, credentials, headers, tokens, query strings, or stack traces. Superadmin has no resolve/delete endpoint or UI control.
- The tenant UI is `/admin/issues`: regular `admin` sees read-only controls; `tenant_admin` sees lifecycle actions. This log is for application/operational failures. Candidate cheating/audit evidence remains in `violations` and `violation_events` in the assessment database.

### Tenant compiler
- `compiler_enabled` is per tenant. Terraform creates an isolated Lambda from the platform-owned ECR image only when enabled, and writes `PRACTICE_COMPILER_MODE=lambda` plus the tenant function ARN to that server.
- Lambda mode supports C, C++, Python, and Java; validates ARN/language/input, limits code to 100 KB, stdin to 10 KB, output to 64 KB, one in-flight run per student, and 10 runs/student/minute.
- Lambda image child processes receive a clean environment. Terraform bounds memory (256–3008 MB), timeout (10–30 seconds), and reserved concurrency (1–20), and grants the app permission to invoke only its tenant function.
- Local mode keeps browser-local Python/C/C++ and the EC2 runner for C/C++/Python/COBOL/Java. COBOL is not currently supported in Lambda mode.

### API ownership map
- Tenant/global identity: `src/server/routes/tenants.ts`, user routes at the top of `admin.ts`, `auth.ts`, `tenantContext.ts`, `TenantManagement.tsx`, `UserManagement.tsx`.
- Assessment administration: remaining `admin.ts` routes plus Question Bank, Batch, Practice, Student, Results, Dashboard, and AI Settings pages.
- Candidate lifecycle: `student.ts`, `studentAuth.ts`, login/confirm/exam/practice/submit pages, `api.ts`.
- Answer buffer and AI queue: `cache.ts`; the older `src/ai/queue.ts` exists but the server uses the cache-owned queue.
- Recording: `examRecorder.ts`, confirm/exam pages, `/student/exam/recording-url`, and `s3.ts`.
- Compiler: `localRunner.ts`, `coderunner.ts`, `lambdaCompiler.ts`, and `infra/compiler-lambda/**`.
- Provisioning and superadmin log observation: `tenants.ts`, `tenantProvisioner.ts`, `tenantLogReader.ts`, `tenantIssueQuery.ts`, `terraform/tenant-instance/**`, `TenantManagement.tsx`, and `api.ts`.

### Application secrets (AWS Secrets Manager, disabled by default)
- `src/server/services/appSecrets.ts` can load sensitive configuration from Secrets Manager instead of `.env`. It is **off by default and off in production today**; when `APP_SECRETS_ENABLED !== 'true'`, `loadAppSecrets()` returns immediately, constructs no `SecretsManagerClient`, and never touches `process.env`.
- **Startup order is load-bearing.** `server.ts` awaits `loadAppSecrets()` and only then runs `await import('./index.js')`. The dynamic import is required: `index.ts` validates `JWT_SECRET` and `postgres.ts` reads `DATABASE_URL` at module load, so a static import would evaluate before secrets are applied. Do not convert it back to a top-level import.
- Only keys listed in `MANAGED_SECRET_KEYS` are applied; anything else is reported through `ignoredKeys` so a mistyped key is visible instead of silently inert. This also prevents a secret from overwriting `PATH`, `NODE_ENV`, or other operational variables.
- A failed load exits the process rather than continuing on stale `.env` values — silently running against another environment's database is the worse failure.
- Values are never logged or returned; status and test responses expose key names only, and raw AWS errors are replaced with a generic message because they embed ARNs and account ids.
- Superadmin surface: `client/src/components/SecretsPanel.tsx`, embedded at the bottom of the tenant control page `/tenants` (`TenantManagement.tsx`) — secrets are control-plane infrastructure, so they live where superadmin already manages tenants, domains, and Terraform. There is no standalone page; the old `/secrets` route now redirects to `/tenants` so existing bookmarks do not 404. APIs are `GET /api/admin/secrets/status` and `POST /api/admin/secrets/test` in `src/server/routes/secrets.ts`, both behind `requireSuperAdmin`. The test action only reads a secret to validate ARN, region, and IAM permission; it never applies it to the running process.
- Enabling is deliberately **not** an API action — it lives in the server `.env`. A compromised superadmin session must not be able to repoint the application at an attacker-controlled secret.
- The EC2 role needs `secretsmanager:GetSecretValue` on that exact ARN. `ListSecrets` is intentionally not granted (`terraform/tenant-instance/main.tf`), so `aws secretsmanager list-secrets` from the instance is expected to fail.


## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | **Yes** | — | Signs admin and student JWTs. Server exits at startup if missing. Use ≥32 random bytes. |
| `JWT_EXPIRES_IN` | Unused | — | Present in older documentation, but current admin login hard-codes `24h`. Do not assume changing it has an effect. |
| `DATABASE_URL` | Prod | — | FSA-CLS assessment PostgreSQL connection. Absent = `data/eaudit.db`. |
| `CONTROL_DATABASE_URL` | **Prod** | local SQLite only | Global admin/tenant PostgreSQL connection. Required in production; never falls back to `DATABASE_URL`. |
| `CONTROL_SQLITE_PATH` | No | `data/control-plane.db` | Local control-plane SQLite file. |
| `CONTROL_DB_POOL_MAX` | No | `5` | Control-plane PostgreSQL pool maximum. |
| `LOG_DATABASE_URL` | **Prod** | local SQLite only | Current tenant operational issue PostgreSQL connection. Required in production and isolated from both other planes. |
| `LOG_SQLITE_PATH` | No | `data/tenant-logs.db` | Local current-tenant log-plane SQLite file. |
| `LOG_DB_POOL_MAX` | No | `5` | Log-plane PostgreSQL pool maximum. |
| `DATABASE_MAINTENANCE_DB` | No | `postgres` | Maintenance database used by `npm run db:ensure`; deployment role needs `CONNECT` and `CREATEDB`. |
| `ALLOWED_ORIGINS` | No | `http://localhost:5173` | CORS whitelist, comma-separated |
| `SESSION_SECRET` | Prod | local fallback | Must be at least 32 characters in production or startup exits. |
| `SKIP_TIME_CHECK` | No | — | Set to `'true'` to bypass exam time-window validation in any mode |
| `GEMINI_API_KEY` | No | — | Fallback AI key if `ai_settings` table is empty |
| `ANSWER_FLUSH_INTERVAL` | No | `5000` | Milliseconds between answer buffer flushes |
| `QUEUE_PROCESS_INTERVAL` | No | `10000` | Milliseconds between AI queue processing ticks |
| `DB_POOL_MAX` | No | `10` | PostgreSQL connection pool max size |
| `DB_POOL_MIN` | No | `2` | PostgreSQL connection pool min size |
| `TENANT_SLUG` | No | `fsa-cls` | Current assessment data-plane tenant; takes precedence over `DEFAULT_TENANT_SLUG`. |
| `DEFAULT_TENANT_SLUG` | No | `fsa-cls` | Default/current data-plane tenant fallback. |
| `DEFAULT_TENANT_NAME` / `_B64` | No | derived | Current tenant display name; Terraform uses Base64 form in user data. |
| `DEFAULT_TENANT_CONTACT_EMAIL` / `_B64` | No | `admin@fsa-cls.local` | Current tenant contact identity. |
| `DEFAULT_TENANT_DOMAIN` | No | FSA: `epoc.devfasttrack.com` | Current tenant dedicated FQDN. Other tenant domains follow `epoc.<tenant-label>.devfasttrack.com`. |
| `DEFAULT_TENANT_APP_URL` | No | tenant HTTPS domain, then first allowed origin | Tenant login redirect/application URL. |
| `CONTROL_PLANE_LOG_SECRET_ARNS` | Control host only | empty | Comma-separated explicit Secrets Manager ARN allowlist for selected remote tenant log reads; maximum 100. |
| `TENANT_PROVISIONING_ENABLED` | No | `false` | Hard gate for Terraform control-plane execution. |
| `TERRAFORM_BIN` | No | `terraform` | Terraform executable. |
| `TERRAFORM_STATE_BUCKET` | Provisioning | — | Encrypted remote-state S3 bucket. |
| `TERRAFORM_STATE_REGION` | No | `ap-southeast-1` | Remote-state region. |
| `TERRAFORM_LOCK_TABLE` | Provisioning | — | DynamoDB state-lock table. |
| `TENANT_TERRAFORM_WORKDIR` | No | `data/tenant-terraform` | Persistent per-tenant Terraform work root. |
| `TENANT_COMPILER_IMAGE_URI` | Compiler tenants | — | Versioned platform-owned ECR image used for tenant Lambda compilers. |
| `PRACTICE_COMPILER_MODE` | No | `local` | `lambda` routes Practice Run Code to Lambda; any other value is local mode. |
| `PRACTICE_COMPILER_LAMBDA_ARN` | Lambda mode | — | Current tenant compiler function ARN, normally written by Terraform. |
| `ENABLE_SERVER_CODE_RUN` | No | enabled | Set to `'false'` to disable server-side code execution (`POST /api/student/run` returns 503). Browser-local runs (python/c/cpp) are unaffected. |
| `SUPERADMIN_USERNAME` | No | `supperadmin` | Username seeded as the first `admin_users` row (role `superadmin`) when the table is empty. See **Admin authentication**. |
| `SUPERADMIN_PASSWORD` | No | `superadmin123#2nf` | Password for the seeded superadmin account above. Set this explicitly in production instead of relying on the hardcoded default. |
| `FSA_TENANT_ADMIN_USERNAME` | No | `adminfsa` | Username seeded as the FSA-CLS `tenant_admin` when that tenant has no administrator yet. Superadmin cannot reach tenant assessment data, so without this account a fresh install has no way into `/admin/*`. |
| `FSA_TENANT_ADMIN_PASSWORD` | No | `adminfsa123#2nf` | Password for the seeded tenant administrator above. The default lives in git history — change it immediately after first login. |
| `APP_SECRETS_ENABLED` | No | `false` | Load configuration from AWS Secrets Manager. Any value other than `'true'` keeps the `.env`-only path with no AWS calls. |
| `APP_SECRETS_ARN` | When enabled | — | ARN of the JSON secret holding configuration. Required if `APP_SECRETS_ENABLED=true`; startup fails fast when missing or malformed. |
| `APP_SECRETS_REGION` | No | `AWS_REGION` | Region of that secret. |
| `AWS_ACCESS_KEY_ID` | Rec | — | IAM key for S3 recording uploads. Absent → recording endpoint returns 503. |
| `AWS_SECRET_ACCESS_KEY` | Rec | — | IAM secret for S3. |
| `AWS_REGION` | No | `us-east-1` | S3 bucket region. |
| `S3_RECORDINGS_BUCKET` | Rec | — | S3 bucket that stores exam screen recordings. |

## Important project-specific notes

- **Control/data-plane boundary rule:** admin authentication, `admin_users`, tenant configuration, Terraform jobs, and tenant audit events must import `src/server/db/controlPlane.ts`. Assessment questions, batches, students, answers, results, violations, and AI grading must import `src/server/db/postgres.ts`. Never join across these connections; resolve tenant/admin identity in middleware, then enforce access before querying the FSA-CLS data-plane.
- **Data-plane binding rule:** `data_plane_metadata.tenant_slug` is immutable after initialization (legacy `fsa` may normalize once to `fsa-cls`). Startup must fail if `TENANT_SLUG` attempts to rebind an existing assessment database to another tenant.
- **Migration rule:** do not delete legacy control tables or assessment rows as part of startup migration. Preserve bcrypt hashes, map only legacy slug `fsa` to `fsa-cls`, keep superadmin global (`tenant_id=NULL`), and keep explicitly assigned non-FSA users in their existing tenant.
- There is drift between current TypeScript source and legacy/generated JS checked into the repo. Prefer `src/**` and `client/src/**` when reasoning about behavior.
- The frontend build uses hashed filenames, so any manual static sync to `public/` must update `public/index.html` to the new hash.
- There is no lint script. Tenant/provisioning/compiler regression coverage runs through `npm run test:tenant`; all other areas still rely on both TypeScript checks, full build, and targeted runtime verification.
- For frontend changes that affect actual exam behavior, verify against the runtime path being served, not just against source edits or `client/dist` output.
- **Known question-group hazard:** `POST /student/exam/start` currently deletes preassigned questions for a pending student and regenerates them by module without carrying `question_group`; its insert also omits `exam_questions.question_group`. This conflicts with the composite `(id, question_group)` design used by admin student import. Any work on exam start/assignment must reconcile these paths and add regression tests before relying on cross-group isolation.
- **Known fresh-Postgres initialization risk:** `practice_submissions` is created before `students` in the PostgreSQL initialization sequence even though it references `students(id)`. Existing upgraded databases may hide this ordering issue; verify initialization against a brand-new PostgreSQL database when changing schema startup.
- **Known approval gap:** tenant `pending` status gates Terraform but is not rejected by admin login/auth middleware; only `suspended` is blocked. If approved-only application access is required, enforce it server-side and test both new and existing JWTs. (FSA-CLS itself is self-healed to `approved` at startup — see the tenant lifecycle bullet in the security model.)
- **Bí mật của Terraform chỉ sống trong `terraform.tfvars`.** Root `.gitignore` chặn `*.tfvars`, `*.pem`, `*.key` cho mọi thư mục module, với ngoại lệ `!*.tfvars.example`. File `.example` được commit nhưng chỉ chứa placeholder — nó đã từng chứa mật khẩu database production thật. Không liệt kê tên file cụ thể trong `.gitignore`: bản cũ ghi `eaudit-key-ipv6.pem` trong khi `local_file.private_key` tạo ra `eaudit-key.pem`, sai tên nên khóa SSH riêng bị commit vào repo.
- **Credential hygiene:** `terraform-ipv6/eaudit-key.pem` is tracked in the legacy Terraform tree. Do not read, print, copy, or reuse it. Treat it as compromised, rotate/remove it through a separately approved security change, and never add private keys to Git.
- The DB layer and route layer mix SQLite-style `?` placeholders and PostgreSQL-style `$1` placeholders depending on code path. Before changing queries, verify which runtime path (`DATABASE_URL` present vs absent) is intended. `db.query()` in `src/server/db/postgres.ts` auto-translates `?` → `$N` for the Postgres branch, so **`?` is always the safe/portable choice** for any query that can run under both DB modes (i.e. anything not already inside a `USE_SQLITE` / `else` Postgres-only branch); a stray `$1` in a shared code path (not inside an explicit non-SQLite branch) will crash under SQLite with "Too many parameter values were provided." One such bug (the duplicate-ID check in `POST /questions/import`) was found and fixed this way — if you add new shared queries, default to `?`.
- `FileCache` in `src/server/cache.ts` initializes `dataDir`/`queueFile` as class field defaults (`path.join(process.cwd(), 'data')` / `.../data/queue.json`) so the constructor's `ensureDataDir()` has a valid path outside Vercel/production. If these fields are ever refactored, keep them initialized before `ensureDataDir()` runs — leaving them unassigned crashes `npm run dev` immediately on startup (`ERR_INVALID_ARG_TYPE` in `fs.mkdirSync`).
- **Fixed:** `query()` in `src/server/db/postgres.ts` used to decide how to run a SQLite statement purely by checking `text.trim().toUpperCase().startsWith('SELECT')` — anything else (including `INSERT ... RETURNING id`) went through `stmt.run(...)`, which always returns `rows: []`. This silently broke any `INSERT ... RETURNING` under local SQLite dev: `POST /batches/:id/students/import` in `admin.ts` reads `studentResult.rows[0]?.id` after such an insert, got `undefined`, and `if (!studentId) continue;` skipped exam_questions assignment for every invited student (student row created, but with zero questions assigned). Fix: the SQLite branch now also routes through `.all()` when the SQL text contains `RETURNING` (case-insensitive), not just when it starts with `SELECT`. Postgres was never affected (its branch always returns real rows regardless of statement type). If similar "insert succeeded but the returned row is empty" symptoms show up again in local SQLite dev, check this function first.
- If a frontend fix appears correct in source but has no effect in manual testing on the real deployment, check whether `deploy/scripts/deploy.sh` has actually been re-run on the EC2 instance since the fix landed on `main` (see "Actual production deployment" above) before assuming the React code itself is wrong.
- **`USE_SQLITE` logic is inconsistent across files** — `postgres.ts` and `admin.ts` use `!process.env.DATABASE_URL`; `student.ts` uses `process.env.USE_SQLITE === 'true' || process.env.NODE_ENV !== 'production'`. Before changing DB queries, verify which runtime path is intended.
- The DB layer auto-converts `?` placeholders to `$1/$2/...` style when running in PostgreSQL mode (see `query()` in `postgres.ts`). Do not mix placeholder styles in a single query string.
- If a frontend fix appears correct in source but has no effect in manual testing, check `public/index.html`, the hashed asset filename under `public/assets`, and the built bundle contents before debugging the React code further.
- The `admin_users` table is not listed in the DB-layer table descriptions of older doc, but it is created at startup alongside the others.
- `multer` is configured with `memoryStorage()` only (no disk writes). File size limit is not currently set — consider adding a `limits: { fileSize }` option for production.
- The `xlsx` package (`v0.18.5`) is end-of-life with known vulnerabilities. Treat uploaded Excel files as untrusted input.

## Verification expectations

- For control-plane changes, run `npm run test:tenant`, both TypeScript builds, and verify local startup creates/uses `data/control-plane.db` while `data/eaudit.db` retains assessment data and `data_plane_metadata.tenant_slug` equals `fsa-cls`.
- Frontend exam changes should be verified against the actual served runtime, not just via source inspection. For local manual testing, run both `npm run dev` (backend) and `cd client && npm run dev` (Vite) and exercise the real flow in a browser — this matches production's `client/dist` + Node backend split more closely than editing source and assuming it works.
- Syncing to `public/assets` + `public/index.html` is only relevant if you've confirmed the environment you're testing against actually serves from `public/` (uncommon — see "Static runtime path" above). Don't do it by default for this project's real deployment; instead rely on `deploy/scripts/deploy.sh` rebuilding `client/dist/` on the server.
- For anti-cheat changes, verify both browser behavior and backend recording:
  - browser-side blocking / auto-submit behavior
  - network calls to `/api/student/violation` and `/api/student/exam/submit`
  - resulting counts in admin results / violations data
- For student auth changes, verify the full auth flow:
  - `POST /student/verify` returns `student_token`
  - `localStorage.studentToken` is set after confirm page
  - All student API requests carry `Authorization: Bearer <token>` header
  - Requests without token return 401
- Build failures in `StudentExam.tsx` are easy to trigger if old duplicated code blocks are left behind during refactors; if Vite reports a stray `}` or duplicate definitions, inspect the bottom half of the file for leftover blocks from earlier edits.

## Files worth checking together for exam/anti-cheat work

- `client/src/pages/StudentExam.tsx`
- `client/src/pages/StudentLogin.tsx` (verify flow: access code → studentToken)
- `client/src/pages/StudentConfirm.tsx` (stores studentToken to localStorage)
- `client/src/services/api.ts` (request interceptors for both admin and student tokens)
- `src/server/middleware/studentAuth.ts` (student JWT verification)
- `src/server/routes/student.ts`
- `src/server/cache.ts`
- `client/src/hooks/useMonacoJavaCompletions.ts` (IntelliSense snippet sizes — relevant for suspicious_paste threshold calibration)
- `public/index.html` (if testing static runtime)
- `public/assets/*.js` (to confirm the runtime bundle really contains the expected change)

## Files worth checking together for question bank / import / export / AI grading work

- `src/server/routes/admin.ts` (import parsing, `question_group`/`question_plain` population, export endpoints)
- `src/server/db/postgres.ts` (`question_bank` schema + migrations for both SQLite and Postgres)
- `src/server/cache.ts` (AI grading prompt construction — must use `question_plain`, not raw `question_sample`)
- `src/utils/string.ts` (`stripHtml`, `sanitizeFilename`, `buildContentDisposition`, `normalizeUnicode`)
- `client/src/pages/QuestionBank.tsx` (Module + Question Group filters, import UI)
- `client/src/services/api.ts` (`adminApi.getQuestionGroups`, other question-bank endpoints)

## Notable current behavior

- Clipboard attempts are counted as violations. Clipboard interception is handled inside the Monaco CodeEditor component (not via DOM events on the wrapper), because Monaco stops DOM event propagation internally.
- Leaving fullscreen for more than 5 seconds records `fullscreen_exit`. A second fullscreen exit after the first violation triggers force-submit from the client.
- Chrome side-panel extensions (e.g. Monica AI) opened during a fullscreen exam are detected as `extension_panel` via a `document.documentElement` width-shrink heuristic — see "Extension side-panel detection" above. Do not use `window.innerWidth`/`window.screen.width` for this; they don't change when a side panel is open.
- Violation locking threshold: `violation_count >= 2` for any single type OR `total_violations >= 2`, applied uniformly to **every** type. The former `suspicious_paste`/`focus_lost` log-only exemption (`isLogOnly`/`LOG_ONLY_TYPES`) was **removed on 2026-07-29** — both are now lockable and count toward the total.
- `suspicious_paste` is detected via Monaco `onDidChangeModelContent` with threshold ≥ **300 chars** per change event (lowered from 1200 on 2026-07-29 to catch Notes-copied answers; see Anti-Cheat v2 section). **Do not raise it back or re-enable large IntelliSense snippets** without pairing the length check with a snippet exclusion — the larger snippets in `useMonacoJavaCompletions.ts` (up to `GlobalExceptionHandler` at 1093 chars) now exceed 300 and would false-positive if typed; they are only safe because they are currently unused.
- `focus_lost` is detected via `window` `blur`/`focus` events with a **3-second grace timer** (rewritten 2026-07-29, replacing the old 5s×3 polling heartbeat). A `blur` starts the timer; a `focus` before it fires cancels it; if it fires with focus still lost, the violation is reported. Event-based rather than polling to avoid aliasing short focus-losses.
- Each violation report also appends a row to `violation_events` (timestamp, type, `text_length`, `content_preview` ≤ 500 chars for `suspicious_paste`, `question_id`). Admins review these via the "🔍 Xem chi tiết" popup on the Results page.
- Server auto-submits the exam when the deadline passes (detected on `GET /exam/questions` → returns `410 Gone`, `reason: 'timeout'`).
- Server auto-submits the exam when the student has been disconnected for more than 120 seconds (`reason: 'absent_too_long'`).
- Runtime anti-cheat behavior depends heavily on `client/src/pages/StudentExam.tsx`; many server-side changes alone will not alter what candidates experience in the browser.
- Student API authentication uses JWT (`studentToken`), not the `x-student-id` header. Any code that still reads `x-student-id` from request headers on student endpoints is stale and should be replaced.
- Internal diagnostic endpoints (`/api/test-db`, `/api/queue/*`, `/api/cache/flush`, `/api/stats`) require admin JWT. `/api/init-tables` has been removed — DB init runs automatically on server startup.
