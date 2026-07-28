---
name: playwright-e2e-conventions
description: "House conventions for writing and refactoring Playwright end-to-end tests: fixture-injected page objects, component objects, semantic locators, storageState auth, and assertion placement. Use this whenever writing a new .spec.ts, adding or editing a page object, setting up Playwright fixtures or config, reviewing E2E test code, or debugging flaky tests — even if the request just says 'write a test for X' or 'this test is flaky' without mentioning Playwright conventions explicitly."
---

# Playwright E2E Conventions

These are opinionated house rules. They exist because the default patterns people
reach for — classic Selenium-style Page Object Model, `beforeEach` wiring, CSS
selectors — produce suites that get slower and more brittle as they grow. Follow
these unless the user explicitly asks for something different.

## Project layout

```
tests/
├── fixtures.ts          # single source of test/expect exports
├── pages/               # page objects (one per route/major surface)
├── components/          # nav, modals, tables, anything cross-page
├── setup/auth.setup.ts  # storageState producer
└── specs/               # *.spec.ts — scenarios and assertions only
```

Specs import `test` and `expect` from `../fixtures`, never from `@playwright/test`
directly. That single indirection is what makes the fixture layer work.

## Compose page objects through fixtures, not constructors

Never write `new SomePage(page)` inside a spec or a `beforeEach`. Wire objects
once in `fixtures.ts` and destructure them in the test signature. Fixtures are
lazy, so a spec only pays the setup cost of the objects it actually names.

```ts
// fixtures.ts
import { test as base } from '@playwright/test';
import { CheckoutPage } from './pages/checkout';
import { Nav } from './components/nav';

type Fixtures = { checkout: CheckoutPage; nav: Nav };

export const test = base.extend<Fixtures>({
  checkout: async ({ page }, use) => use(new CheckoutPage(page)),
  nav:      async ({ page }, use) => use(new Nav(page)),
});
export { expect } from '@playwright/test';
```

```ts
// specs/checkout.spec.ts
import { test, expect } from '../fixtures';

test('applies a discount code', async ({ checkout }) => {
  await checkout.goto();
  await checkout.applyCode('SAVE10');
  await expect(checkout.total).toHaveText('£45.00');
});
```

If setup needs teardown, put it after the `use()` call in the fixture. That is
the whole reason `use` is a callback rather than a return.

## What belongs in a page object

Page objects earn their keep by encapsulating **workflows**, not selectors.
Playwright's semantic locators are already resilient to markup churn, so a class
that is forty one-line getters wrapping single locators is pure indirection —
it adds a file to open without removing any fragility.

Write a method when it hides a multi-step sequence the test shouldn't care about:

```ts
async createProject(name: string) {
  await this.page.getByRole('button', { name: 'New project' }).click();
  await this.page.getByLabel('Project name').fill(name);
  await this.page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
}
```

The spec says `await dashboard.createProject('Apollo')` and stays readable when
the modal gains a step.

**Expose `Locator`s, keep `expect` in the spec.** A page object property like
`readonly total = this.page.getByTestId('order-total')` is good. A method named
`assertTotalIs()` is not — it buries the assertion, wrecks the failure message,
and makes the spec's intent invisible at a glance.

## Component objects over god objects

Navs, sidebars, modals, and data tables appear on many pages. Model those
separately and compose them rather than letting `DashboardPage` absorb
everything on the dashboard. If a page object passes ~100 lines, that is the
signal to split it.

## Locators

Prefer, in order: `getByRole` → `getByLabel` → `getByPlaceholder` / `getByText`
→ `getByTestId`. Reach for `page.locator()` with raw CSS only when nothing else
identifies the element, and treat that as a bug in the app's accessibility
rather than a normal choice.

Scope locators to a container instead of relying on `.nth()` or `.first()`:

```ts
const row = page.getByRole('row', { name: 'Apollo' });
await row.getByRole('button', { name: 'Archive' }).click();
```

Index-based selection breaks the moment ordering changes; scoping does not.

## Never log in through the UI

Authenticate once in a setup project, save `storageState`, and have the
authenticated project depend on it. This buys more speed and stability than any
structural decision in this file, so do it before optimising anything else.

```ts
// playwright.config.ts
projects: [
  { name: 'setup', testMatch: /auth\.setup\.ts/ },
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], storageState: '.auth/user.json' },
    dependencies: ['setup'],
  },
],
```

## Readability

Group multi-phase tests with `test.step()`. The trace viewer output becomes
dramatically easier to read, and it usually removes the urge to extract a
helper purely to give a block a name.

Keep one behaviour per test. Resist chaining unrelated assertions to save
runtime — a failure should point at one thing.

## Anti-patterns

| Don't | Do |
|---|---|
| `new LoginPage(page)` in a spec or `beforeEach` | Inject via `test.extend` |
| `page.locator('.btn-primary')` | `getByRole('button', { name: '…' })` |
| `assertTotalIs()` on a page object | Expose the locator, `expect` in the spec |
| `waitForTimeout()` | Web-first assertions — they auto-retry |
| Logging in via the UI in every spec | `storageState` from a setup project |
| One class covering an entire page | Page object + component objects |

## When to skip all of this

Under roughly twenty specs, page object classes cost more than they return.
Use plain helper functions plus fixtures, and introduce classes when duplication
actually shows up. Say so if the user's suite is small rather than scaffolding
structure they don't need yet.