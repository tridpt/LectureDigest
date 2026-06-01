"""
Unified email sender — supports HTTP API providers (works on hosts that block
SMTP ports, e.g. Render/Railway free tier) with an SMTP fallback for local dev.

Provider selection (first available wins):
  1. Resend HTTP API   — set RESEND_API_KEY (recommended for cloud deploys)
  2. SMTP              — set SMTP_HOST / SMTP_USER / SMTP_PASS (works locally)
  3. Console (dev)     — neither configured: log instead of sending

Why: Render/Railway block outbound SMTP ports (25/465/587) at the infra level,
so smtp.gmail.com fails with "[Errno 101] Network is unreachable". Transactional
email APIs use HTTPS (port 443) and work everywhere.
"""

import os
import json
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import httpx

logger = logging.getLogger("email")


def email_provider() -> str:
    """Return which provider will be used: 'resend', 'smtp', or 'console'."""
    if os.getenv("RESEND_API_KEY", "").strip():
        return "resend"
    if os.getenv("SMTP_HOST", "").strip() and os.getenv("SMTP_USER", "").strip():
        return "smtp"
    return "console"


def is_email_configured() -> bool:
    """True if a real email provider (not console) is configured."""
    return email_provider() != "console"


def _from_address() -> str:
    """Resolve the From address, preferring an explicit EMAIL_FROM/SMTP_FROM."""
    return (
        os.getenv("EMAIL_FROM", "").strip()
        or os.getenv("SMTP_FROM", "").strip()
        or os.getenv("SMTP_USER", "").strip()
        or "no-reply@lecturedigest.app"
    )


def send_email(to_email: str, subject: str, html_body: str, text_body: str = "") -> bool:
    """
    Send an email via the best available provider.
    Returns True if sent, False if only logged (console mode).
    Raises on real send failures so callers can surface errors.
    """
    provider = email_provider()

    if provider == "resend":
        return _send_via_resend(to_email, subject, html_body, text_body)
    if provider == "smtp":
        return _send_via_smtp(to_email, subject, html_body, text_body)

    # Console fallback (dev / no provider configured)
    logger.info("EMAIL (console mode — no provider configured)")
    logger.info("To: %s | Subject: %s", to_email, subject)
    return False


def _send_via_resend(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Send through the Resend HTTPS API (works behind SMTP-blocking hosts)."""
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    from_addr = _from_address()
    # Resend requires "Name <email>" or bare email; default display name if bare
    if "<" not in from_addr:
        from_addr = f"LectureDigest <{from_addr}>"

    payload = {
        "from": from_addr,
        "to": [to_email],
        "subject": subject,
        "html": html_body,
    }
    if text_body:
        payload["text"] = text_body

    resp = httpx.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        content=json.dumps(payload),
        timeout=15,
    )
    if resp.status_code >= 400:
        logger.error("Resend API error %s: %s", resp.status_code, resp.text[:200])
        raise Exception(f"Resend API error {resp.status_code}: {resp.text[:200]}")
    logger.info("Email sent via Resend to %s", to_email)
    return True


def _send_via_smtp(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Send through classic SMTP (works locally; blocked on many cloud hosts)."""
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_pass = os.getenv("SMTP_PASS", "").strip()
    smtp_from = _from_address()

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_from if "<" in smtp_from else f"LectureDigest <{smtp_from}>"
    msg["To"] = to_email
    if text_body:
        msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        # Extract bare address for the envelope sender
        envelope_from = smtp_from.split("<")[-1].rstrip(">").strip()
        server.sendmail(envelope_from, to_email, msg.as_string())
    logger.info("Email sent via SMTP to %s", to_email)
    return True
