/**
 * Transactional email via Resend's REST API. No-op (with a log) until
 * RESEND_API_KEY is set on the Convex deployment. Used from actions only.
 */

export async function sendEmail(args: {
  to: string[];
  subject: string;
  html: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email skipped — RESEND_API_KEY not set] ${args.subject}`);
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }
  const from = process.env.EMAIL_FROM ?? "notifications@example.com";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: args.to, subject: args.subject, html: args.html }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Resend error ${res.status}: ${body}`);
    return { sent: false, reason: `Resend ${res.status}` };
  }
  return { sent: true };
}
