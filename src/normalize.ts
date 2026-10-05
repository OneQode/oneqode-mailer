import type { Address, Mailbox, MailMessage, NormalizedMessage } from './types.js'

function mailbox(address: Address): Mailbox {
  const box = typeof address === 'string' ? { email: address } : address
  const email = box.email.trim()
  if (!email || /[\r\n]/.test(email)) throw new TypeError(`Invalid email address: ${JSON.stringify(box.email)}`)
  const name = box.name?.replace(/[\r\n]+/g, ' ').trim()
  return name ? { email, name } : { email }
}

export function normalize(msg: MailMessage): NormalizedMessage {
  const to = (Array.isArray(msg.to) ? msg.to : [msg.to]).map(mailbox)
  if (to.length === 0) throw new TypeError('Mail needs at least one recipient')
  if (!msg.subject) throw new TypeError('Mail needs a subject')
  if (!msg.text && !msg.html) throw new TypeError('Mail needs a text or html body')

  return {
    from: mailbox(msg.from),
    to,
    replyTo: msg.replyTo ? mailbox(msg.replyTo) : undefined,
    subject: msg.subject.replace(/[\r\n]+/g, ' '),
    text: msg.text,
    html: msg.html,
    attachments: (msg.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: typeof a.content === 'string' ? Buffer.from(a.content, 'utf8') : Buffer.from(a.content),
    })),
  }
}
