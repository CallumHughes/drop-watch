# Notifications

DropWatch has two alert channels: a Home Assistant webhook and email. They are
independent, both optional, and an unconfigured channel is not a failed one —
with no mailer, nothing about the logs or the webhook path differs from an
instance that never had one. Delivery failures on either channel are logged and
never fail a check.

| Configuration | Set | Alerts go to | Auth |
|---|---|---|---|
| Webhook-only | `ha_url` + `ha_webhook_id` (settings page) | Home Assistant | Sign in immediately; no verification, no password reset |
| Email-only | `RESEND_API_KEY`, then tick **Email alerts** | Your account's inbox | Verification required, password reset and change email available |
| Both | both of the above | Both, independently | As above |

An alert fires once per configured channel, and the dedupe in `alert_state` is
per `(product, rule)` rather than per channel, so a price that stays below its
target does not re-notify anywhere.

## Alert rules

Armed per product, on its detail page:

- **`target`** — the price is at or below the target you set.
- **`drop_percent`** — the price fell by at least N% against the previous
  observation. 1–99%.
- **`restock`** — stock went from out to in. Edge-triggered; a page that never
  said it was out of stock never fires this.

Plus one you do not arm, because it is about the watch rather than the price:

- **`watch_broken`** — fires once after N consecutive failed checks (5 by
  default, 2–50) and stays quiet until the product recovers. Selectors rot
  silently, and this is how you find out.

After a rule fires it is quiet for the cooldown (12h by default) unless the
price drops further — a cheaper price is always news.

## Home Assistant

`packages/core/notify` POSTs JSON to `${haUrl}/api/webhook/${webhookId}`.
Webhooks need no auth token — the id is the secret, and `local_only: true` keeps
it LAN-bound.

> **The webhook only fires for products owned by an admin.** It is the
> instance's channel, configured on the admin-only settings page, and it is
> checked per send against the product's owner. Non-admin accounts get email
> alerts only. Nothing in the UI hints at this, so it is worth knowing before
> you wonder why an invited user's watches are silent.

```yaml
- alias: Price drop alert
  trigger:
    - platform: webhook
      webhook_id: drop_watch
      local_only: true
  action:
    - service: notify.mobile_app_yourphone
      data:
        title: "{{ trigger.json.title }}"
        message: "{{ trigger.json.currency }}{{ trigger.json.price }} (was {{ trigger.json.previousPrice }})"
        data:
          url: "{{ trigger.json.url }}"
```

Every field is always present, `null` where it does not apply, so a template can
address `trigger.json.previousPrice` without guarding first:

| Field | Notes |
|---|---|
| `productId`, `url` | Always set. `url` is the *cheapest* tracked store's, not necessarily the one that was just checked — a product can track more than one. |
| `listingId` | Which store `url` belongs to. `null` only for the settings page's test notification, which has no listing. |
| `title`, `imageUrl`, `currency` | `null` until a check has extracted them. |
| `price`, `previousPrice`, `pctChange` | Decimal **strings**, never floats. `pctChange` is signed, one decimal place. |
| `inStock` | `null` when the page did not say. |
| `rule` | `target`, `drop_percent`, `restock`, `watch_broken`, or `test`. |
| `consecutiveFailures` | Length of the failure streak on `watch_broken`; `null` otherwise. |
| `error` | Failure detail on `watch_broken`; `null` otherwise. |

Branch on `watch_broken` if you want a different notification for it:

```yaml
  action:
    - choose:
        - conditions: "{{ trigger.json.rule == 'watch_broken' }}"
          sequence:
            - service: notify.mobile_app_yourphone
              data:
                title: "Watch broken: {{ trigger.json.title }}"
                message: "{{ trigger.json.consecutiveFailures }} failed checks — {{ trigger.json.error }}"
```

The settings page's **send test** button posts the same shape with `rule:
"test"`, which is the only way to prove the automation exists: Home Assistant
answers 200 to a webhook with no automation behind it.

## Email

Email is opt-in and **`RESEND_API_KEY` is the switch**. Setting it is the
statement "I want the mailer"; leaving it unset leaves a fully working tracker
rather than a half-broken auth flow.

```bash
RESEND_API_KEY=re_...                    # from https://resend.com
EMAIL_FROM=drop-watch@example.com        # optional; see below
APP_URL=http://server.local:3001         # optional; links inside the mail
```

In development these go in **both** `apps/web/.env` and `apps/worker/.env` —
auth mail is sent by the web app, alert mail by the worker, and each process
only reads its own file. In Docker they go in the root `.env` once, which reaches
both containers. Then restart both `web` and `worker` and tick **Email alerts**
on the settings page.

Alert recipients are not a field you type into: mail goes to the product owner's
own account address, and only if that address is **verified**. An unverified
account receives nothing.

Without `EMAIL_FROM` the sender is Resend's shared `onboarding@resend.dev`. It
needs no verified domain, which is why it is the default — but Resend will only
deliver from it to the address that owns your Resend account. That is enough for
a one-account instance and useless for anything else; verify a domain and set
`EMAIL_FROM` to escape it.

### What turning it on changes about sign-in

With a mailer configured, Better Auth gains `requireEmailVerification`,
verification mail on signup, password reset and change email — and
`/forgot-password`, `/verify-email` and the change-email half of `/account` start
being served. Without one, all of that is off: `requireEmailVerification` is
*not* hardcoded `true`, because on a box whose signup endpoint closes after the
first account it would lock that account behind a mail that can never be sent.

### Locked out? `pnpm db:verify-user`

That is the same trap in its other form: signup closes once the first account
exists, so an account created *before* the key was set — or one whose
verification mail bounced — is a locked box with no second account to rescue it
from. The escape hatch:

```bash
pnpm db:verify-user admin@drop-watch.local
```

Or, straight at the database:

```sql
UPDATE "user" SET email_verified = true WHERE email = 'admin@drop-watch.local';
```

`pnpm db:seed` already writes `emailVerified: true`, so a seeded admin never
needs this.

### Docker

The same `RESEND_API_KEY` switch, and nothing else. Set it in `.env` — the
root file if you built from source, or the one next to `docker-compose.yml` if
you are running the published images — and restart `web` and `worker`:

```bash
docker compose up -d
```

No rebuild, no build argument: the flag is read at request time, in every
image, so one published `web` image is correct whether or not a mailer is
configured. `EMAIL_FROM` and `APP_URL` go in the same file if you are setting
them.

Note that the variable has to be in the **root `.env`** (or the shell) for a
container, not only in `apps/web/.env`. Compose interpolates the root file,
and an `environment` key in `docker-compose.yml` overrides `env_file` even when
it resolves to nothing.
