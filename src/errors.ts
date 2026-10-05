/** permanent: the message was refused, so stop. transient: try the next provider.
 *  unavailable: try the next one and bench this one (auth, suspension, unverified sender). */
export type FailureKind = 'permanent' | 'transient' | 'unavailable'

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: FailureKind,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(`${provider}: ${message}`, options)
    this.name = 'ProviderError'
  }
}

export class MailDeliveryError extends Error {
  constructor(readonly attempts: ProviderError[]) {
    super(`Mail not delivered: ${attempts.map((a) => a.message).join('; ')}`)
    this.name = 'MailDeliveryError'
  }

  get permanent(): boolean {
    return this.attempts.at(-1)?.kind === 'permanent'
  }
}
