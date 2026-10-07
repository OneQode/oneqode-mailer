# @oneqode/mailer

Transactional mail for OneQode services, with ordered provider failover. A message goes to the first configured provider and moves down the chain only when another provider could plausibly succeed.

```ts
import { mailerFromEnv } from '@oneqode/mailer'

const mailer = mailerFromEnv() // null when no provider has credentials (local dev)

const { provider, messageId } = await mailer.send({
  from: { email: 'noreply@oneqode.com', name: 'OneQode Identity' },
  to: 'user@example.com',
  replyTo: 'support@oneqode.com',
  subject: 'Reset your password',
  text: '...',
  html: '<p>...</p>',
  attachments: [{ filename: 'nda.pdf', content: pdfBuffer, contentType: 'application/pdf' }],
})
```

`send` resolves with the provider that accepted the message, or rejects with `MailDeliveryError`, whose `attempts` lists each provider's failure.

## Configuration

| Variable | Default | |
|---|---|---|
| `MAIL_PROVIDERS` | `sendgrid,postmark,smtp` | Order to try. Unknown names throw at startup. |
| `SENDGRID_API_KEY` | | Enables SendGrid. |
| `POSTMARK_SERVER_TOKEN` | | Enables Postmark. |
| `POSTMARK_MESSAGE_STREAM` | `outbound` | |
| `SMTP_HOST` | | Enables SMTP. |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `true` when port is 465 | Implicit TLS. Port 587 upgrades with STARTTLS. |
| `SMTP_USER`, `SMTP_PASS` | | |
| `SMTP_FROM` | the message's sender | Sender address for SMTP only, keeping the display name. For an SMTP host that may only send from another domain. |
| `MAIL_TIMEOUT_MS` | `10000` | Per provider attempt. |
| `MAIL_PROVIDER_COOLDOWN_MS` | `300000` | How long an unavailable provider is benched. |

A provider listed in `MAIL_PROVIDERS` without its credentials is skipped, so a provider can be added to the chain before its account is ready: set the credential when it is.

Services that read credentials under other names can pass their own env object: `mailerFromEnv({ ...process.env, SENDGRID_API_KEY: config.sendgridKey })`. For full control, build the chain with `createMailer({ providers: [sendgridProvider(...), smtpProvider(...)] })`.

## When it fails over

Every failure is classified as one of three kinds:

| Kind | Meaning | Examples | Effect |
|---|---|---|---|
| `unavailable` | This provider cannot send for us right now | SendGrid 401/403, Postmark 401 or account/sender error codes (pending approval, unconfirmed sender signature, suspended), SMTP auth failure | Next provider, and this one is tried last for the cooldown period |
| `transient` | A temporary failure | 429, 5xx, timeouts, connection errors | Next provider |
| `permanent` | The message itself was refused | SendGrid 400/413, Postmark 422 validation or inactive recipient, SMTP 5xx on the recipient | Stop and reject. Another provider would refuse it too, or it is a bounce we should respect |

A benched provider is still tried, last, rather than dropped, so a stale bench can delay mail but never lose it.

## Things to know

- **Tracking is always off.** Open and click tracking are disabled on every provider. Tracked links rewrite one-time auth and signing links through a third-party domain.
- **A timeout can produce a duplicate.** If a provider accepts a message but the response is lost, the next provider sends it again. For password resets and OTPs a duplicate beats no mail.
- **Each provider needs its own domain setup.** A fallback only helps if its DKIM records are published and its account is approved before it is needed.
- **Postmark caps a message at 50 recipients** (To, Cc and Bcc combined).

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Releases publish to npmjs when a `v*` tag matching `package.json` is pushed.
