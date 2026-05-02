"""
Gemini AI client — singleton with hot-reload of API key from .env.
Provides call_gemini() and call_gemini_multi() with automatic model fallback and retry logic.
"""

import os
import time
import logging
from google import genai
from dotenv import load_dotenv

logger = logging.getLogger("gemini")

load_dotenv(override=True)

_genai_client: genai.Client | None = None

# Primary model + fallback for free-tier quota
PRIMARY_MODEL  = "gemini-2.5-flash"
FALLBACK_MODEL = "gemini-2.5-flash-lite"

# Retryable error patterns
_QUOTA_PATTERNS  = ["429", "free_tier", "RESOURCE_EXHAUSTED"]
_RETRY_PATTERNS  = ["503", "overloaded", "500", "INTERNAL", "UNAVAILABLE", "capacity"]


def get_genai_client() -> genai.Client:
    """Always read API key fresh from env so .env changes take effect without restart."""
    global _genai_client
    current_key = os.getenv("GEMINI_API_KEY")
    if _genai_client is None or getattr(_genai_client, "_api_key_cached", None) != current_key:
        _genai_client = genai.Client(api_key=current_key)
        _genai_client._api_key_cached = current_key
    return _genai_client


def _is_quota_error(err_str: str) -> bool:
    """Check if the error indicates quota exhaustion (switch model)."""
    return "429" in err_str and any(p in err_str for p in ["free_tier", "RESOURCE_EXHAUSTED"])


def _is_retryable(err_str: str) -> bool:
    """Check if the error is retryable (server overloaded, transient)."""
    lower = err_str.lower()
    if _is_quota_error(err_str):
        return False  # quota errors are handled by model fallback, not retry
    return any(p.lower() in lower for p in _RETRY_PATTERNS) or (
        "429" in err_str  # generic rate limit (not free tier)
    )


def _parse_retry_after(err_str: str) -> int | None:
    """Try to extract retry-after seconds from error message."""
    import re
    match = re.search(r'(\d+)s', err_str)
    if match:
        return min(int(match.group(1)), 60)
    return None


def _call_with_retry(generate_fn, retries: int = 4) -> str:
    """
    Core retry logic shared by call_gemini and call_gemini_multi.
    generate_fn(model: str) should call client.models.generate_content
    and return resp.text.
    """
    client = get_genai_client()
    models = [PRIMARY_MODEL, FALLBACK_MODEL]

    for model in models:
        last_err = None
        for attempt in range(retries):
            try:
                text = generate_fn(client, model)
                if model != PRIMARY_MODEL:
                    logger.warning("Used fallback model: %s", model)
                return text
            except Exception as e:
                last_err = e
                err_str = str(e)

                if _is_quota_error(err_str):
                    logger.warning("Quota exhausted for %s, trying fallback...", model)
                    break  # → try next model

                if _is_retryable(err_str):
                    retry_after = _parse_retry_after(err_str)
                    wait = retry_after if retry_after else (2 ** attempt)
                    logger.info("%s retry %d/%d in %ds: %s", model, attempt+1, retries, wait, err_str[:80])
                    time.sleep(wait)
                    continue

                # Non-retryable error → propagate immediately
                raise
        else:
            # Exhausted all retries for this model
            if model == FALLBACK_MODEL:
                raise Exception(f"All models exhausted after {retries} retries. Last error: {last_err}")
            # else continue to fallback model

    raise Exception("Gemini call failed across all models")


def call_gemini(prompt: str, retries: int = 4) -> str:
    """
    Call Gemini with a text prompt.
    Automatic model fallback + exponential backoff retry.
    """
    def _gen(client, model):
        resp = client.models.generate_content(model=model, contents=prompt)
        return resp.text

    return _call_with_retry(_gen, retries=retries)


def call_gemini_multi(contents: list, retries: int = 4) -> str:
    """
    Call Gemini with multi-part contents (e.g. [prompt_text, gemini_file]).
    Same retry + fallback logic as call_gemini.
    """
    def _gen(client, model):
        resp = client.models.generate_content(model=model, contents=contents)
        return resp.text

    return _call_with_retry(_gen, retries=retries)

