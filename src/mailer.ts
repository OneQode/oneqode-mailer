import { MailDeliveryError, ProviderError } from './errors.js'
import { normalize } from './normalize.js'
import type { MailMessage, Provider, SendResult } from './types.js'

export interface MailerOptions {
  /** Tried in order until one accepts the message. */
  providers: Provider[]
  /** How long an `unavailable` provider is skipped before it is tried first again. */
  cooldownMs?: number
  logger?: Pick<Console, 'warn'>
  now?: () => number
}

export interface Mailer {
  readonly providers: readonly string[]
  send(msg: MailMessage): Promise<SendResult>
}

export function createMailer(opts: MailerOptions): Mailer {
  if (opts.providers.length === 0) throw new Error('createMailer needs at least one provider')
  const cooldownMs = opts.cooldownMs ?? 5 * 60_000
  const logger = opts.logger ?? console
  const now = opts.now ?? Date.now
  const benchedUntil = new Map<string, number>()

  // Benched providers still go last rather than being dropped: a stale bench must not lose mail.
  function order(): Provider[] {
    const t = now()
    const isBenched = (p: Provider) => (benchedUntil.get(p.name) ?? 0) > t
    return [...opts.providers.filter((p) => !isBenched(p)), ...opts.providers.filter(isBenched)]
  }

  return {
    providers: opts.providers.map((p) => p.name),

    async send(msg) {
      const normalized = normalize(msg)
      const attempts: ProviderError[] = []

      for (const provider of order()) {
        try {
          const { messageId } = await provider.send(normalized)
          benchedUntil.delete(provider.name)
          if (attempts.length > 0) logger.warn(`[mailer] delivered via ${provider.name} after ${attempts.length} failed attempt(s)`)
          return { provider: provider.name, messageId }
        } catch (err) {
          const failure =
            err instanceof ProviderError
              ? err
              : new ProviderError(provider.name, 'transient', (err as Error).message, undefined, { cause: err })
          attempts.push(failure)
          if (failure.kind === 'permanent') break
          if (failure.kind === 'unavailable') benchedUntil.set(provider.name, now() + cooldownMs)
          logger.warn(`[mailer] ${failure.message} (${failure.kind})`)
        }
      }

      throw new MailDeliveryError(attempts)
    },
  }
}
