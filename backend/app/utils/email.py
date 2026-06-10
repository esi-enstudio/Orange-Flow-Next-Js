import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from config.settings import settings

logger = logging.getLogger(__name__)


def send_email(to_email: str, subject: str, html_body: str) -> bool:
    if not settings.SMTP_HOST or not settings.SMTP_USER:
        logger.warning("SMTP not configured — cannot send email.")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASS)
            server.sendmail(msg["From"], [to_email], msg.as_string())

        logger.info(f"Password reset email sent to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        return False


def build_reset_email(reset_link: str, user_name: str) -> str:
    return f"""\
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
      <tr><td style="background:#7c3aed;padding:24px;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:20px">OrangeFlow</h1>
      </td></tr>
      <tr><td style="padding:32px 24px">
        <h2 style="margin:0 0 8px;color:#1e293b;font-size:18px">Password Reset</h2>
        <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6">
          Hello <strong>{user_name}</strong>,<br>
          We received a request to reset your password. Click the button below to set a new one.
        </p>
        <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#7c3aed;padding:12px 28px">
          <a href="{reset_link}" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;display:inline-block">Reset Password</a>
        </td></tr></table>
        <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">
          This link expires in {settings.PASSWORD_RESET_EXPIRE_MINUTES} minutes.<br>
          If you didn't request this, ignore this email.
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>"""
