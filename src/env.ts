import { createMailer, type Mailer, type MailerOptions } from './mailer.js'
import { postmarkProvider } from './providers/postmark.js'
import { sendgridProvider } from './providers/sendgrid.js'
import { smtpProvider } from './providers/smtp.js'
import type { Provider } from './types.js'

type Env = Record<string, string | undefined>

const DEFAULT_ORDER = 'sendgrid,postmark,smtp'

function int(env: Env, key: string): number | undefined {
  const raw = env[key]
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) throw new Error(`${key} must be a non-negative integer, got ${JSON.stringify(raw)}`)
  return n
}

const builders: Record<string, (env: Env, timeoutMs?: number) => Provider | undefined> = {
  sendgrid: (env, timeoutMs) => (env.SENDGRID_API_KEY ? sendgridProvider({ apiKey: env.SENDGRID_API_KEY, timeoutMs }) : undefined),
  postmark: (env, timeoutMs) =>
    env.POSTMARK_SERVER_TOKEN
      ? postmarkProvider({ serverToken: env.POSTMARK_SERVER_TOKEN, messageStream: env.POSTMARK_MESSAGE_STREAM || undefined, timeoutMs })
      : undefined,
  smtp: (env, timeoutMs) =>
    env.SMTP_HOST
      ? smtpProvider({
          host: env.SMTP_HOST,
          port: int(env, 'SMTP_PORT'),
          secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : undefined,
          user: env.SMTP_USER || undefined,
          pass: env.SMTP_PASS || undefined,
          timeoutMs,
        })
      : undefined,
}

/** Builds the chain from MAIL_PROVIDERS, skipping any provider without credentials. Null when none has any. */
export function mailerFromEnv(env: Env = process.env, opts: Omit<MailerOptions, 'providers'> = {}): Mailer | null {
  const names = (env.MAIL_PROVIDERS || DEFAULT_ORDER).split(',').map((n) => n.trim().toLowerCase()).filter(Boolean)
  const timeoutMs = int(env, 'MAIL_TIMEOUT_MS')

  const providers = names.flatMap((name) => {
    const build = builders[name]
    if (!build) throw new Error(`Unknown mail provider ${JSON.stringify(name)} in MAIL_PROVIDERS`)
    return build(env, timeoutMs) ?? []
  })

  if (providers.length === 0) return null
  return createMailer({ cooldownMs: int(env, 'MAIL_PROVIDER_COOLDOWN_MS'), ...opts, providers })
}
