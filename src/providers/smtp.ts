import nodemailer, { type Transporter } from 'nodemailer'
import { ProviderError, type FailureKind } from '../errors.js'
import type { Mailbox, Provider } from '../types.js'

export interface SmtpOptions {
  host: string
  port?: number
  secure?: boolean
  user?: string
  pass?: string
  /** Sender address for this provider only, keeping the message's display name. */
  from?: string
  timeoutMs?: number
}

export function classifySmtpError(err: { code?: string; responseCode?: number }): FailureKind {
  if (err.code === 'EAUTH' || err.responseCode === 530 || err.responseCode === 535) return 'unavailable'
  if (err.responseCode && err.responseCode >= 500) return 'permanent'
  return 'transient'
}

const address = ({ email, name }: Mailbox) => ({ address: email, name: name ?? '' })

export function smtpProvider(opts: SmtpOptions, transport?: Transporter): Provider {
  const port = opts.port ?? 587
  const timeout = opts.timeoutMs ?? 10_000
  const transporter =
    transport ??
    nodemailer.createTransport({
      host: opts.host,
      port,
      secure: opts.secure ?? port === 465,
      auth: opts.user ? { user: opts.user, pass: opts.pass ?? '' } : undefined,
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
    })

  return {
    name: 'smtp',
    async send(msg) {
      try {
        const info = await transporter.sendMail({
          from: address(opts.from ? { ...msg.from, email: opts.from } : msg.from),
          to: msg.to.map(address),
          replyTo: msg.replyTo ? address(msg.replyTo) : undefined,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          attachments: msg.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
          })),
        })
        return { messageId: info.messageId }
      } catch (err) {
        const e = err as Error & { code?: string; responseCode?: number }
        throw new ProviderError('smtp', classifySmtpError(e), e.message, e.responseCode, { cause: err })
      }
    },
  }
}
