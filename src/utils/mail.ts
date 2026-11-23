import { env } from "../config/env.js";

interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendMail(input: MailInput): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.info(`[mail:dev] ${input.subject} -> ${input.to}\n${input.text}`);
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`Resend email failed (${response.status}): ${body}`);
    return false;
  }

  return true;
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  url: string,
): Promise<void> {
  await sendMail({
    to,
    subject: "Reset your PizzaHub password",
    text: `Hi ${name},\n\nUse this link to reset your PizzaHub password. It expires in 1 hour:\n${url}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Hi ${name},</p><p>Use the link below to reset your PizzaHub password. It expires in 1 hour.</p><p><a href="${url}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
}
