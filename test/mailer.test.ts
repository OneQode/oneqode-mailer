import { describe, expect, it, vi } from 'vitest'
import { createMailer, MailDeliveryError, ProviderError, type FailureKind, type Provider } from '../src/index.js'

const msg = { from: 'noreply@oneqode.com', to: 'a@example.com', subject: 'Hi', text: 'Hello' }
const quiet = { warn: () => {} }

function fake(name: string, outcomes: (FailureKind | 'ok' | Error)[]): Provider & { calls: number } {
  const p = {
    name,
    calls: 0,
    async send() {
      const outcome = outcomes[Math.min(p.calls++, outcomes.length - 1)]
      if (outcome === 'ok') return { messageId: `${name}-id` }
      if (outcome instanceof Error) throw outcome
      throw new ProviderError(name, outcome, 'boom')
    },
  }
  return p
}

describe('createMailer', () => {
  it('uses the first provider when it succeeds', async () => {
    const a = fake('a', ['ok'])
    const b = fake('b', ['ok'])
    const mailer = createMailer({ providers: [a, b], logger: quiet })
    await expect(mailer.send(msg)).resolves.toEqual({ provider: 'a', messageId: 'a-id' })
    expect(b.calls).toBe(0)
  })

  it.each<FailureKind>(['transient', 'unavailable'])('fails over on %s errors', async (kind) => {
    const mailer = createMailer({ providers: [fake('a', [kind]), fake('b', [kind]), fake('c', ['ok'])], logger: quiet })
    await expect(mailer.send(msg)).resolves.toMatchObject({ provider: 'c' })
  })

  it('treats a non-ProviderError throw as transient', async () => {
    const mailer = createMailer({ providers: [fake('a', [new Error('socket hang up')]), fake('b', ['ok'])], logger: quiet })
    await expect(mailer.send(msg)).resolves.toMatchObject({ provider: 'b' })
  })

  it('stops at a permanent error without trying the rest', async () => {
    const b = fake('b', ['ok'])
    const mailer = createMailer({ providers: [fake('a', ['permanent']), b], logger: quiet })
    const err = await mailer.send(msg).catch((e) => e)
    expect(err).toBeInstanceOf(MailDeliveryError)
    expect(err.permanent).toBe(true)
    expect(b.calls).toBe(0)
  })

  it('reports every attempt when all providers fail', async () => {
    const mailer = createMailer({ providers: [fake('a', ['unavailable']), fake('b', ['transient'])], logger: quiet })
    const err: MailDeliveryError = await mailer.send(msg).catch((e) => e)
    expect(err.attempts.map((a) => [a.provider, a.kind])).toEqual([['a', 'unavailable'], ['b', 'transient']])
    expect(err.permanent).toBe(false)
  })

  it('benches an unavailable provider, then retries it first after the cooldown', async () => {
    let t = 0
    const a = fake('a', ['unavailable', 'ok'])
    const b = fake('b', ['ok'])
    const mailer = createMailer({ providers: [a, b], cooldownMs: 1000, now: () => t, logger: quiet })

    await mailer.send(msg)
    await expect(mailer.send(msg)).resolves.toMatchObject({ provider: 'b' })
    expect(a.calls).toBe(1)

    t = 1001
    await expect(mailer.send(msg)).resolves.toMatchObject({ provider: 'a' })
  })

  it('still tries a benched provider last rather than dropping the message', async () => {
    const a = fake('a', ['unavailable', 'ok'])
    const b = fake('b', ['ok', 'transient'])
    const mailer = createMailer({ providers: [a, b], now: () => 0, logger: quiet })

    await mailer.send(msg)
    await expect(mailer.send(msg)).resolves.toMatchObject({ provider: 'a' })
  })

  it('does not bench on transient errors', async () => {
    const a = fake('a', ['transient', 'ok'])
    const mailer = createMailer({ providers: [a, fake('b', ['ok'])], now: () => 0, logger: quiet })
    await mailer.send(msg)
    await expect(mailer.send(msg)).resolves.toMatchObject({ provider: 'a' })
  })

  it('logs failovers without recipient addresses', async () => {
    const warn = vi.fn()
    const mailer = createMailer({ providers: [fake('a', ['transient']), fake('b', ['ok'])], logger: { warn } })
    await mailer.send(msg)
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls.flat().join(' ')).not.toContain('a@example.com')
  })

  it('rejects an invalid message before calling any provider', async () => {
    const a = fake('a', ['ok'])
    const mailer = createMailer({ providers: [a], logger: quiet })
    await expect(mailer.send({ ...msg, text: undefined })).rejects.toThrow(TypeError)
    await expect(mailer.send({ ...msg, to: [] })).rejects.toThrow(TypeError)
    await expect(mailer.send({ ...msg, to: 'a@example.com\r\nBcc: x@evil.com' })).rejects.toThrow(TypeError)
    expect(a.calls).toBe(0)
  })

  it('refuses an empty provider list', () => {
    expect(() => createMailer({ providers: [] })).toThrow()
  })
})
