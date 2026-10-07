import project from "../../../config/project.json" with { type: "json" };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The public contact address. It is never committed: it comes from the
 * CONTACT_EMAIL environment variable (local .env, GitHub Actions secret,
 * Vercel env var). Throws if missing so no request goes out without it.
 */
export function contactEmail(): string {
  const value = process.env.CONTACT_EMAIL?.trim();
  if (!value || !EMAIL_RE.test(value) || value.endsWith("@example.com")) {
    throw new Error(
      "CONTACT_EMAIL is not set. Copy .env.example to .env and set it (see docs/runbook.md).",
    );
  }
  return value;
}

/** User-Agent sent with every outbound request, built at run time. */
export function userAgent(): string {
  return `${project.botName}/${project.botVersion} (official-source fresher job index; contact: ${contactEmail()})`;
}
