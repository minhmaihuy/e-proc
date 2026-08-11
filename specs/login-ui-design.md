# Login UI Design

## Problem

The tenant control login referenced `login-*` classes that had no stylesheet, while
the tenant-admin login used an unrelated card layout and linked to the removed
`/admin/setup` flow. The two ownership planes therefore looked inconsistent and
the tenant-admin page advertised an unavailable, security-retired action.

## Requirements

1. `/admin/login` and `/tenant/login` must share one responsive, accessible visual
   system while clearly identifying tenant access versus global control-plane access.
2. Tenant admins must authenticate only through `loginAdmin`; superadmins must
   authenticate only through `loginTenantControl`.
3. The shared form must provide labelled required inputs, correct autocomplete,
   loading/error feedback, keyboard-visible focus, and password visibility control.
4. Alternate portal links must point only between `/admin/login` and `/tenant/login`.
   No self-service setup link may be rendered.
5. Successful authentication must replace navigation history and route tenant roles
   to `/admin/dashboard` and superadmin to `/tenants`.
6. Regression tests must cover accessible controls, credential submission, bounded
   API errors, password visibility, and removal of the retired setup call-to-action.

## Verification

- Run frontend TypeScript type-check and Vitest.
- Run a production Vite build.
- Exercise both login pages at desktop and mobile widths in a real browser.
- Run the maintenance harness against the changed login files with this specification.
