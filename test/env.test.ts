import { describe, expect, it } from 'vitest'
import { mailerFromEnv } from '../src/index.js'

describe('mailerFromEnv', () => {
  it('returns null when no provider has credentials', () => {
    expect(mailerFromEnv({})).toBeNull()
  })

  it('defaults to sendgrid, postmark, smtp and skips any without credentials', () => {
    expect(mailerFromEnv({ SENDGRID_API_KEY: 'SG.k', SMTP_HOST: 'smtp.example.com' })?.providers).toEqual(['sendgrid', 'smtp'])
    expect(
      mailerFromEnv({ SENDGRID_API_KEY: 'SG.k', POSTMARK_SERVER_TOKEN: 't', SMTP_HOST: 'smtp.example.com' })?.providers,
    ).toEqual(['sendgrid', 'postmark', 'smtp'])
  })

  it('follows MAIL_PROVIDERS order', () => {
    const env = { MAIL_PROVIDERS: 'postmark, sendgrid', SENDGRID_API_KEY: 'SG.k', POSTMARK_SERVER_TOKEN: 't', SMTP_HOST: 'h' }
    expect(mailerFromEnv(env)?.providers).toEqual(['postmark', 'sendgrid'])
  })

  it('rejects an unknown provider name', () => {
    expect(() => mailerFromEnv({ MAIL_PROVIDERS: 'sendgrid,mailgun', SENDGRID_API_KEY: 'SG.k' })).toThrow(/mailgun/)
  })

  it('rejects a malformed number', () => {
    expect(() => mailerFromEnv({ SMTP_HOST: 'h', SMTP_PORT: 'abc' })).toThrow(/SMTP_PORT/)
  })
})
