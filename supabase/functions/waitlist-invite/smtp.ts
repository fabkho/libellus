/**
 * Sending over plain SMTP, provider-neutral: any mail service's SMTP relay (or your own server)
 * through the function secrets `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` and,
 * optionally, `SMTP_FROM_NAME` (read in mail.ts). The client is nodemailer (pinned in deno.json),
 * the SMTP client Supabase's own example uses on the edge runtime; it stays behind `Mailer`, and only
 * index.ts loads this file, so the tests inject a fake and never load nodemailer.
 *
 * Port 465 (and 2465) is implicit TLS; any other port starts in plain text and upgrades with
 * STARTTLS when the server offers it. Hosted Supabase blocks outgoing connections to ports 25 and
 * 587, so use 465 or the provider's alternative port (README.md).
 */
import nodemailer from 'nodemailer'
import { implicitTls, type Mailer, type SmtpConfig } from './mail.ts'

export function createSmtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: implicitTls(config.port),
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })
  return {
    async send(mail) {
      await transport.sendMail({
        from: config.fromName ? { name: config.fromName, address: config.from } : config.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      })
    },
  }
}
