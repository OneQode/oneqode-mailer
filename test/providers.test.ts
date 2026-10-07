import nodemailer from 'nodemailer'
import { describe, expect, it, vi } from 'vitest'
import { normalize } from '../src/normalize.js'
import { classifyPostmarkError, postmarkProvider } from '../src/providers/postmark.js'
import { classifySendGridStatus, sendgridProvider } from '../src/providers/sendgrid.js'
import { classifySmtpError, smtpProvider } from '../src/providers/smtp.js'
import { ProviderError } from '../src/errors.js'

const msg = normalize({
  from: { email: 'legal@oneqode.com', name: 'OneQode "Legal"' },
  to: ['a@example.com', { email: 'b@example.com', name: 'B' }],
  replyTo: 'mnda+abc@oneqode.com',
  subject: 'Your NDA',
  text: 'plain',
  html: '<p>html</p>',
  attachments: [{ filename: 'nda.pdf', content: new Uint8Array([1, 2, 3]), contentType: 'application/pdf' }],
})

async function rejection(p: Promise<unknown>): Promise<ProviderError> {
  const err = (await p.catch((e) => e)) as ProviderError
  expect(err).toBeInstanceOf(ProviderError)
  return err
}

describe('sendgrid', () => {
  function service(send: (data: any) => Promise<any>) {
    return { setApiKey: vi.fn(), setTimeout: vi.fn(), send: vi.fn(send) } as any
  }

  it('maps the message and disables tracking', async () => {
    const svc = service(async () => [{ headers: { 'x-message-id': 'sg-1' } }, {}])
    const result = await sendgridProvider({ apiKey: 'k' }, svc).send(msg)

    expect(result).toEqual({ messageId: 'sg-1' })
    expect(svc.setApiKey).toHaveBeenCalledWith('k')
    const data = svc.send.mock.calls[0][0]
    expect(data).toMatchObject({
      from: { email: 'legal@oneqode.com', name: 'OneQode "Legal"' },
      to: [{ email: 'a@example.com' }, { email: 'b@example.com', name: 'B' }],
      replyTo: { email: 'mnda+abc@oneqode.com' },
      text: 'plain',
      html: '<p>html</p>',
      attachments: [{ filename: 'nda.pdf', type: 'application/pdf', content: 'AQID', disposition: 'attachment' }],
    })
    expect(data.trackingSettings.clickTracking.enable).toBe(false)
  })

  it('classifies HTTP errors from the SDK', async () => {
    const svc = service(async () => {
      throw Object.assign(new Error('Forbidden'), { code: 403, response: { body: { errors: [{ message: 'blocked' }] } } })
    })
    const err = await rejection(sendgridProvider({ apiKey: 'k' }, svc).send(msg))
    expect(err.kind).toBe('unavailable')
    expect(err.status).toBe(403)
    expect(err.message).toContain('blocked')
  })

  it('treats network errors as transient', async () => {
    const svc = service(async () => {
      throw Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' })
    })
    expect((await rejection(sendgridProvider({ apiKey: 'k' }, svc).send(msg))).kind).toBe('transient')
  })

  it.each([
    [401, 'unavailable'],
    [403, 'unavailable'],
    [429, 'transient'],
    [503, 'transient'],
    [400, 'permanent'],
    [413, 'permanent'],
  ])('HTTP %i is %s', (status, kind) => {
    expect(classifySendGridStatus(status)).toBe(kind)
  })
})

describe('postmark', () => {
  function respond(status: number, body: unknown) {
    return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))
  }

  it('maps the message to the Postmark API', async () => {
    const fetch = respond(200, { MessageID: 'pm-1', ErrorCode: 0, Message: 'OK' })
    const result = await postmarkProvider({ serverToken: 't', fetch }).send(msg)

    expect(result).toEqual({ messageId: 'pm-1' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.postmarkapp.com/email')
    expect((init!.headers as Record<string, string>)['X-Postmark-Server-Token']).toBe('t')
    expect(JSON.parse(init!.body as string)).toEqual({
      From: '"OneQode \\"Legal\\"" <legal@oneqode.com>',
      To: 'a@example.com, "B" <b@example.com>',
      ReplyTo: 'mnda+abc@oneqode.com',
      Subject: 'Your NDA',
      TextBody: 'plain',
      HtmlBody: '<p>html</p>',
      Attachments: [{ Name: 'nda.pdf', ContentType: 'application/pdf', Content: 'AQID' }],
      TrackOpens: false,
      TrackLinks: 'None',
      MessageStream: 'outbound',
    })
  })

  it('treats an account still pending approval as unavailable', async () => {
    const fetch = respond(422, { ErrorCode: 412, Message: 'pending approval' })
    expect((await rejection(postmarkProvider({ serverToken: 't', fetch }).send(msg))).kind).toBe('unavailable')
  })

  it('treats an inactive recipient as permanent', async () => {
    const fetch = respond(422, { ErrorCode: 406, Message: 'inactive recipient' })
    expect((await rejection(postmarkProvider({ serverToken: 't', fetch }).send(msg))).kind).toBe('permanent')
  })

  it('treats a network failure as transient', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect((await rejection(postmarkProvider({ serverToken: 't', fetch }).send(msg))).kind).toBe('transient')
  })

  it.each([
    [401, undefined, 'unavailable'],
    [429, undefined, 'transient'],
    [500, 101, 'transient'],
    [503, 100, 'transient'],
    [422, 10, 'unavailable'],
    [422, 300, 'permanent'],
    [413, undefined, 'permanent'],
  ])('HTTP %i ErrorCode %s is %s', (status, code, kind) => {
    expect(classifyPostmarkError(status, code)).toBe(kind)
  })
})

describe('smtp', () => {
  it('maps the message to nodemailer', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true })
    const sendMail = vi.spyOn(transport, 'sendMail')
    const result = await smtpProvider({ host: 'unused' }, transport).send(msg)

    expect(result.messageId).toBeTruthy()
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      from: { address: 'legal@oneqode.com', name: 'OneQode "Legal"' },
      to: [{ address: 'a@example.com', name: '' }, { address: 'b@example.com', name: 'B' }],
      replyTo: { address: 'mnda+abc@oneqode.com', name: '' },
      attachments: [{ filename: 'nda.pdf', contentType: 'application/pdf' }],
    })
  })

  it('sends from SMTP_FROM with the message display name when set', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true })
    const sendMail = vi.spyOn(transport, 'sendMail')
    await smtpProvider({ host: 'unused', from: 'noreply@oneqo.de' }, transport).send(msg)

    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: { address: 'noreply@oneqo.de', name: 'OneQode "Legal"' } })
  })

  it.each([
    [{ code: 'EAUTH', responseCode: 535 }, 'unavailable'],
    [{ code: 'EENVELOPE', responseCode: 530 }, 'unavailable'],
    [{ code: 'EENVELOPE', responseCode: 550 }, 'permanent'],
    [{ code: 'EENVELOPE', responseCode: 451 }, 'transient'],
    [{ code: 'ETIMEDOUT' }, 'transient'],
    [{ code: 'ECONNECTION' }, 'transient'],
  ])('%o is %s', (err, kind) => {
    expect(classifySmtpError(err)).toBe(kind)
  })
})
