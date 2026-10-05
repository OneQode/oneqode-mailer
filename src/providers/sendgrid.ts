import { MailService, type MailDataRequired } from '@sendgrid/mail'
import { ProviderError, type FailureKind } from '../errors.js'
import type { Provider } from '../types.js'

export interface SendGridOptions {
  apiKey: string
  timeoutMs?: number
}

export function classifySendGridStatus(status: number): FailureKind {
  if (status === 401 || status === 403) return 'unavailable'
  if (status === 429 || status >= 500) return 'transient'
  return 'permanent'
}

export function sendgridProvider(opts: SendGridOptions, service = new MailService()): Provider {
  service.setApiKey(opts.apiKey)
  service.setTimeout(opts.timeoutMs ?? 10_000)

  return {
    name: 'sendgrid',
    async send(msg) {
      try {
        const [res] = await service.send({
          from: msg.from,
          to: msg.to,
          replyTo: msg.replyTo,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          attachments: msg.attachments.map((a) => ({
            filename: a.filename,
            type: a.contentType,
            content: a.content.toString('base64'),
            disposition: 'attachment',
          })),
          trackingSettings: {
            clickTracking: { enable: false, enableText: false },
            openTracking: { enable: false },
            subscriptionTracking: { enable: false },
            ganalytics: { enable: false },
          },
        } as MailDataRequired)
        const id = res.headers['x-message-id']
        return { messageId: typeof id === 'string' ? id : undefined }
      } catch (err) {
        const status = (err as { code?: unknown }).code
        if (typeof status === 'number') {
          const detail = JSON.stringify((err as { response?: { body?: unknown } }).response?.body ?? '')
          throw new ProviderError('sendgrid', classifySendGridStatus(status), `HTTP ${status} ${detail}`, status, { cause: err })
        }
        throw new ProviderError('sendgrid', 'transient', (err as Error).message, undefined, { cause: err })
      }
    },
  }
}
