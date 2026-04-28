"""
Authentication routes — register, login, Google OAuth, password reset.
"""

import os
import time
import hashlib
import secrets
import asyncio
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional
import bcrypt
import jwt as pyjwt

from database import (
    db_create_user, db_get_user_by_email, db_get_user_by_id,
    db_update_user, db_get_user_by_google_id,
    db_save_reset_token, db_get_reset_token, db_delete_reset_token,
    db_delete_reset_tokens_for_email, db_cleanup_expired_tokens,
    db_check_rate_limit, db_reset_rate_limit,
    db_delete_user, db_export_user_data,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ═══════════════════════════════════════════════════════
# JWT CONFIG
# ═══════════════════════════════════════════════════════

_JWT_SECRET = os.getenv("JWT_SECRET", "")
if not _JWT_SECRET:
    _JWT_SECRET = secrets.token_hex(32)
    try:
        env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
        with open(env_path, "a", encoding="utf-8") as f:
            f.write(f"\nJWT_SECRET={_JWT_SECRET}\n")
        print(f"[Auth] Generated and saved JWT_SECRET")
    except Exception:
        print(f"[Auth] Generated JWT_SECRET (not saved to .env)")

_JWT_EXPIRY = 7 * 24 * 3600  # 7 days

_AVATAR_COLORS = [
    '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6',
    '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#a855f7'
]


def _create_jwt(user_id: int) -> str:
    payload = {
        "user_id": user_id,
        "exp": int(time.time()) + _JWT_EXPIRY,
        "iat": int(time.time()),
    }
    return pyjwt.encode(payload, _JWT_SECRET, algorithm="HS256")


def _verify_jwt(token: str) -> dict | None:
    try:
        return pyjwt.decode(token, _JWT_SECRET, algorithms=["HS256"])
    except pyjwt.ExpiredSignatureError:
        return None
    except pyjwt.InvalidTokenError:
        return None


def get_current_user(request: Request) -> dict | None:
    """Extract user from Authorization header. Returns user dict or None."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    payload = _verify_jwt(token)
    if not payload:
        return None
    return db_get_user_by_id(payload.get("user_id"))


# ═══════════════════════════════════════════════════════
# REQUEST MODELS
# ═══════════════════════════════════════════════════════

class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=6)
    display_name: str = Field(min_length=1, max_length=50)

class LoginRequest(BaseModel):
    email: str
    password: str

class UpdateProfileRequest(BaseModel):
    display_name: Optional[str] = None
    avatar_color: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None

class GoogleAuthRequest(BaseModel):
    credential: str
    client_id: str = ''

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=6)


# ═══════════════════════════════════════════════════════
# PASSWORD RESET CONFIG
# ═══════════════════════════════════════════════════════

_RESET_TOKEN_EXPIRY = 3600  # 1 hour
_RESET_RATE_LIMIT_SECONDS = 60


def _send_reset_email(to_email: str, reset_url: str, display_name: str = ""):
    """Send password reset email via SMTP. Falls back to console logging in dev."""
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_pass = os.getenv("SMTP_PASS", "").strip()
    smtp_from = os.getenv("SMTP_FROM", smtp_user).strip()

    name = display_name or to_email.split("@")[0]

    html_body = f"""\
<!DOCTYPE html>
<html>
<body style="font-family:'Inter',Arial,sans-serif;background:#0f0f23;color:#e2e8f0;padding:40px 20px;">
<div style="max-width:480px;margin:0 auto;background:#1a1a2e;border-radius:16px;padding:32px;border:1px solid rgba(139,92,246,0.2);">
    <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:48px;margin-bottom:8px;">🔐</div>
        <h2 style="margin:0;color:#fff;font-size:22px;font-weight:800;">Đặt lại mật khẩu</h2>
        <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">LectureDigest</p>
    </div>
    <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Xin chào <strong>{name}</strong>,</p>
    <p style="color:#cbd5e1;font-size:14px;line-height:1.6;">Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Nhấn nút bên dưới để tạo mật khẩu mới:</p>
    <div style="text-align:center;margin:28px 0;">
        <a href="{reset_url}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:#fff;border-radius:12px;font-weight:700;font-size:15px;text-decoration:none;">Đặt lại mật khẩu</a>
    </div>
    <p style="color:#94a3b8;font-size:13px;line-height:1.5;">Link này sẽ hết hạn sau <strong>1 giờ</strong>. Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.</p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:24px 0;">
    <p style="color:#64748b;font-size:11px;text-align:center;">Nếu nút không hoạt động, hãy copy và dán link này vào trình duyệt:<br>
    <a href="{reset_url}" style="color:#8b5cf6;word-break:break-all;">{reset_url}</a></p>
</div>
</body>
</html>
"""

    text_body = f"""Xin chào {name},\n\nĐặt lại mật khẩu LectureDigest:\n{reset_url}\n\nLink hết hạn sau 1 giờ.\nNếu bạn không yêu cầu, hãy bỏ qua email này."""

    if not smtp_host or not smtp_user:
        # Dev mode: print to console
        print(f"\n{'='*60}")
        print(f"📧 PASSWORD RESET EMAIL (dev mode — no SMTP configured)")
        print(f"To: {to_email}")
        print(f"Reset URL: {reset_url}")
        print(f"{'='*60}\n")
        return

    # Production: send via SMTP
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "🔐 Đặt lại mật khẩu — LectureDigest"
    msg["From"] = f"LectureDigest <{smtp_from}>"
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_from, to_email, msg.as_string())
        print(f"[Auth] Reset email sent to {to_email}")
    except Exception as e:
        print(f"[Auth] SMTP error: {e}")
        raise Exception(f"Không thể gửi email: {e}")


# ═══════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════

@router.post("/register")
async def register(req: RegisterRequest, request: Request):
    """Register a new user account."""
    email = req.email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Email không hợp lệ")

    # Rate limiting: prevent mass account creation
    client_ip = request.client.host if request.client else "unknown"
    allowed, retry_after = db_check_rate_limit(f"register:{client_ip}", max_attempts=5, window_secs=600, block_secs=1800)
    if not allowed:
        raise HTTPException(status_code=429, detail=f"Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau {retry_after // 60} phút.")

    if db_get_user_by_email(email):
        raise HTTPException(status_code=409, detail="Email này đã được đăng ký")

    loop = asyncio.get_event_loop()
    pw_hash = await loop.run_in_executor(None, lambda: bcrypt.hashpw(req.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"))

    color_idx = int(hashlib.md5(email.encode()).hexdigest(), 16) % len(_AVATAR_COLORS)
    avatar_color = _AVATAR_COLORS[color_idx]

    user_id = db_create_user(email, req.display_name, pw_hash, avatar_color)
    if not user_id:
        raise HTTPException(status_code=409, detail="Email này đã được đăng ký")

    token = _create_jwt(user_id)
    user = db_get_user_by_id(user_id)

    return {"token": token, "user": user}


@router.post("/login")
async def login(req: LoginRequest, request: Request):
    """Login with email and password."""
    email = req.email.lower().strip()

    # Rate limiting: 5 failed attempts per email → block 15 min
    allowed, retry_after = db_check_rate_limit(f"login:{email}", max_attempts=5, window_secs=300, block_secs=900)
    if not allowed:
        raise HTTPException(status_code=429, detail=f"Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau {retry_after // 60} phút.")

    user = db_get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=401, detail="Email hoặc mật khẩu không đúng")

    loop = asyncio.get_event_loop()
    pw_ok = await loop.run_in_executor(None, lambda: bcrypt.checkpw(req.password.encode("utf-8"), user["password_hash"].encode("utf-8")))
    if not pw_ok:
        raise HTTPException(status_code=401, detail="Email hoặc mật khẩu không đúng")

    # Successful login → reset rate limit counter
    db_reset_rate_limit(f"login:{email}")

    token = _create_jwt(user["id"])
    safe_user = {k: v for k, v in user.items() if k != "password_hash"}

    return {"token": token, "user": safe_user}


@router.get("/me")
async def get_me(request: Request):
    """Get current user info from JWT token."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")
    return {"user": user}


@router.put("/profile")
async def update_profile(req: UpdateProfileRequest, request: Request):
    """Update current user's profile."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")

    new_hash = None
    if req.new_password:
        if not req.current_password:
            raise HTTPException(status_code=400, detail="Vui lòng nhập mật khẩu hiện tại")
        full_user = db_get_user_by_email(user["email"])
        loop = asyncio.get_event_loop()
        pw_ok = await loop.run_in_executor(None, lambda: bcrypt.checkpw(req.current_password.encode("utf-8"), full_user["password_hash"].encode("utf-8")))
        if not pw_ok:
            raise HTTPException(status_code=403, detail="Mật khẩu hiện tại không đúng")
        if len(req.new_password) < 6:
            raise HTTPException(status_code=400, detail="Mật khẩu mới tối thiểu 6 ký tự")
        new_hash = await loop.run_in_executor(None, lambda: bcrypt.hashpw(req.new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"))

    db_update_user(
        user["id"],
        display_name=req.display_name,
        avatar_color=req.avatar_color,
        password_hash=new_hash
    )

    updated = db_get_user_by_id(user["id"])
    return {"user": updated}


@router.post("/google")
async def google_login(req: GoogleAuthRequest):
    """Login/register via Google One Tap or Sign-In button."""
    from google.oauth2 import id_token as google_id_token
    from google.auth.transport import requests as google_requests

    expected_client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not expected_client_id:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID not configured in .env")

    try:
        idinfo = google_id_token.verify_oauth2_token(
            req.credential, google_requests.Request(), expected_client_id,
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {e}")

    google_sub  = idinfo.get("sub", "")
    email       = idinfo.get("email", "").lower().strip()
    name        = idinfo.get("name", "")
    picture     = idinfo.get("picture", "")

    if not email:
        raise HTTPException(status_code=400, detail="Google account has no email")

    user = db_get_user_by_google_id(google_sub)

    if not user:
        user = db_get_user_by_email(email)
        if user:
            db_update_user(
                user["id"],
                google_id=google_sub,
                avatar_url=picture if picture else None,
            )
            user = db_get_user_by_id(user["id"])
        else:
            color_idx = int(hashlib.md5(email.encode()).hexdigest(), 16) % len(_AVATAR_COLORS)
            avatar_color = _AVATAR_COLORS[color_idx]
            user_id = db_create_user(
                email=email,
                display_name=name or email.split("@")[0],
                password_hash="",
                avatar_color=avatar_color,
                google_id=google_sub,
                avatar_url=picture,
            )
            if not user_id:
                raise HTTPException(status_code=409, detail="Không thể tạo tài khoản")
            user = db_get_user_by_id(user_id)

    token = _create_jwt(user["id"])
    safe_user = {k: v for k, v in user.items() if k != "password_hash"}

    return {
        "token": token,
        "user": safe_user,
        "is_new": not bool(db_get_user_by_google_id(google_sub)),
    }


@router.get("/google-client-id")
async def get_google_client_id():
    """Return the Google Client ID for frontend GSI initialization."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    return {"client_id": client_id}


@router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest):
    """Request a password reset link. Always returns success to prevent email enumeration."""
    email = req.email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Email không hợp lệ")

    # Rate limit: 1 request per email per 60 seconds
    allowed, retry_after = db_check_rate_limit(f"reset:{email}", max_attempts=1, window_secs=_RESET_RATE_LIMIT_SECONDS, block_secs=_RESET_RATE_LIMIT_SECONDS)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Vui lòng đợi {retry_after} giây trước khi yêu cầu lại"
        )

    db_cleanup_expired_tokens()

    user = db_get_user_by_email(email)
    if user:
        if not user.get("password_hash"):
            return {"ok": True, "message": "Nếu email tồn tại, chúng tôi đã gửi link đặt lại mật khẩu."}

        now = time.time()
        token = secrets.token_urlsafe(48)
        db_save_reset_token(token, email, now + _RESET_TOKEN_EXPIRY)

        base_url = os.getenv("APP_BASE_URL", "http://localhost:8000").rstrip("/")
        reset_url = f"{base_url}/reset-password?token={token}"

        try:
            _send_reset_email(email, reset_url, user.get("display_name", ""))
        except Exception as e:
            print(f"[Auth] Failed to send reset email: {e}")

    return {"ok": True, "message": "Nếu email tồn tại, chúng tôi đã gửi link đặt lại mật khẩu."}


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest):
    """Reset password using a valid token."""
    db_cleanup_expired_tokens()

    token_data = db_get_reset_token(req.token)
    if not token_data:
        raise HTTPException(status_code=400, detail="Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn")

    email = token_data["email"]
    user = db_get_user_by_email(email)
    if not user:
        db_delete_reset_token(req.token)
        raise HTTPException(status_code=400, detail="Tài khoản không tồn tại")

    loop = asyncio.get_event_loop()
    new_hash = await loop.run_in_executor(
        None,
        lambda: bcrypt.hashpw(req.new_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    )

    db_update_user(user["id"], password_hash=new_hash)

    # Delete this token and all other tokens for the same email
    db_delete_reset_tokens_for_email(email)

    print(f"[Auth] Password reset successful for {email}")
    return {"ok": True, "message": "Mật khẩu đã được đặt lại thành công!"}


@router.get("/verify-reset-token")
async def verify_reset_token(token: str):
    """Verify if a reset token is still valid."""
    db_cleanup_expired_tokens()
    token_data = db_get_reset_token(token)
    if not token_data:
        return {"valid": False}
    return {"valid": True, "email": token_data["email"]}


class DeleteAccountRequest(BaseModel):
    password: str = ""


@router.post("/delete-account")
async def delete_account(req: DeleteAccountRequest, request: Request):
    """Permanently delete a user account and all associated data."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")

    # For password-based accounts (no Google), verify password
    full_user = db_get_user_by_email(user["email"])
    has_google = full_user and full_user.get("google_id")
    has_password = full_user and full_user.get("password_hash")

    if has_password and not has_google:
        # Pure email/password account → require password confirmation
        if not req.password:
            raise HTTPException(status_code=400, detail="Vui lòng nhập mật khẩu để xác nhận xóa tài khoản")
        loop = asyncio.get_event_loop()
        pw_ok = await loop.run_in_executor(
            None,
            lambda: bcrypt.checkpw(req.password.encode("utf-8"), full_user["password_hash"].encode("utf-8"))
        )
        if not pw_ok:
            raise HTTPException(status_code=403, detail="Mật khẩu không đúng")

    user_id = user["id"]
    email = user["email"]

    try:
        db_delete_user(user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể xóa tài khoản: {e}")

    print(f"[Auth] Account deleted: {email} (user_id={user_id})")
    return {"ok": True, "message": "Tài khoản đã được xóa vĩnh viễn"}


@router.get("/export-data")
async def export_data(request: Request):
    """Export all user data as JSON. GDPR data portability."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")

    data = db_export_user_data(user["id"])
    data["exported_at"] = int(time.time())
    return data
