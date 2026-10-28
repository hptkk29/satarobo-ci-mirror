import { Resend } from "resend";

let _client: Resend | null = null;

export function getResendClient(): Resend | null {
  if (_client) return _client;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY missing — email send will be no-op");
    return null;
  }
  _client = new Resend(apiKey);
  return _client;
}

export function getFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL ?? "Sata Robo <onboarding@resend.dev>";
}

export function getReplyTo(): string | undefined {
  return process.env.RESEND_REPLY_TO;
}
