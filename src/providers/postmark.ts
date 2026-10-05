import { ProviderError, type FailureKind } from '../errors.js'
import type { Mailbox, Provider } from '../types.js'

export interface PostmarkOptions {
  serverToken: string
  messageStream?: string
  timeoutMs?: number
  fetch?: typeof fetch
}

// Account or sender problems, not message problems: https://postmarkapp.com/developer/api/overview
const ACCOUNT_ERROR_CODES = new Set([10, 400, 401, 405, 412, 413, 422, 1235, 1236, 1480])

export function classifyPostmarkError(status: number, errorCode?: number): FailureKind {
  if (status === 401) return 'unavailable'
  if (status === 429 || status >= 500) return 'transient'
  if (status === 422 && errorCode !== undefined && ACCOUNT_ERROR_CODES.has(errorCode)) return 'unavailable'
  return 'permanent'
}

function formatMailbox({ email, name }: Mailbox): string {
  return name ? `"${name.replace(/["\\]/g, '\\$&')}" <${email}>` : email
}

export function postmarkProvider(opts: PostmarkOptions): Provider {
  const doFetch = opts.fetch ?? fetch

  return {
    name: 'postmark',
    async send(msg) {
      let res: Response
      try {
        res = await doFetch('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Postmark-Server-Token': opts.serverToken,
          },
          body: JSON.stringify({
            From: formatMailbox(msg.from),
            To: msg.to.map(formatMailbox).join(', '),
            ReplyTo: msg.replyTo ? formatMailbox(msg.replyTo) : undefined,
            Subject: msg.subject,
            TextBody: msg.text,
            HtmlBody: msg.html,
            Attachments: msg.attachments.map((a) => ({
              Name: a.filename,
              ContentType: a.contentType,
              Content: a.content.toString('base64'),
            })),
            TrackOpens: false,
            TrackLinks: 'None',
            MessageStream: opts.messageStream ?? 'outbound',
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        })
      } catch (err) {
        throw new ProviderError('postmark', 'transient', (err as Error).message, undefined, { cause: err })
      }

      const body = (await res.json().catch(() => ({}))) as { MessageID?: string; ErrorCode?: number; Message?: string }
      if (res.ok && !body.ErrorCode) return { messageId: body.MessageID }

      const kind = classifyPostmarkError(res.status, body.ErrorCode)
      throw new ProviderError('postmark', kind, `HTTP ${res.status} ErrorCode ${body.ErrorCode}: ${body.Message}`, res.status)
    },
  }
}
