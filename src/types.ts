export type Address = string | { email: string; name?: string }

export interface Attachment {
  filename: string
  /** Raw bytes; a string is taken as UTF-8 text. Providers do their own encoding. */
  content: Uint8Array | string
  contentType: string
}

export interface MailMessage {
  from: Address
  to: Address | Address[]
  replyTo?: Address
  subject: string
  text?: string
  html?: string
  attachments?: Attachment[]
}

export interface SendResult {
  provider: string
  messageId?: string
}

export interface Provider {
  readonly name: string
  send(msg: NormalizedMessage): Promise<{ messageId?: string }>
}

export interface Mailbox {
  email: string
  name?: string
}

export interface NormalizedMessage {
  from: Mailbox
  to: Mailbox[]
  replyTo?: Mailbox
  subject: string
  text?: string
  html?: string
  attachments: { filename: string; content: Buffer; contentType: string }[]
}
