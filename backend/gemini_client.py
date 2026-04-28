"""
Gemini AI client — singleton with hot-reload of API key from .env.
Provides call_gemini() with automatic model fallback and retry logic.
"""

import os
import time
from google import genai
from dotenv import load_dotenv

load_dotenv(override=True)

_genai_client: genai.Client | None = None

# Primary model + fallback for free-tier quota
# gemini-1.5-flash deprecated; gemini-2.0-flash-lite is the lightest available fallback
PRIMARY_MODEL  = "gemini-2.5-flash"
FALLBACK_MODEL = "gemini-2.5-flash-lite"


def get_genai_client() -> genai.Client:
    """Always read API key fresh from env so .env changes take effect without restart."""
    global _genai_client
    current_key = os.getenv("GEMINI_API_KEY")
    if _genai_client is None or getattr(_genai_client, "_api_key_cached", None) != current_key:
        _genai_client = genai.Client(api_key=current_key)
        _genai_client._api_key_cached = current_key
    return _genai_client


def call_gemini(prompt: str, retries: int = 4) -> str:
    """
    Call Gemini with automatic fallback:
      1. Try PRIMARY_MODEL (gemini-2.5-flash) — higher quality
      2. If 429 quota exhausted → fallback to FALLBACK_MODEL (gemini-2.0-flash)
      3. Retry on 503/overload with exponential backoff
    Returns the response text.
    """
    client = get_genai_client()
    models = [PRIMARY_MODEL, FALLBACK_MODEL]

    for model in models:
        last_err = None
        for attempt in range(retries):
            try:
                resp = client.models.generate_content(model=model, contents=prompt)
                if model != PRIMARY_MODEL:
                    print(f"[LectureDigest] ⚠ Used fallback model: {model}")
                return resp.text
            except Exception as e:
                last_err = e
                err_str = str(e)
                is_quota  = "429" in err_str and "free_tier" in err_str
                is_retry  = "503" in err_str or "overloaded" in err_str.lower() or (
                    "429" in err_str and "free_tier" not in err_str
                )
                if is_quota:
                    print(f"[LectureDigest] Quota exhausted for {model}, trying fallback...")
                    break   # break inner loop → try next model
                if is_retry:
                    wait = 2 ** attempt
                    print(f"[LectureDigest] {model} retry {attempt+1} in {wait}s: {err_str[:60]}")
                    time.sleep(wait)
                    continue
                raise   # non-retryable error → propagate immediately
        else:
            # Exhausted all retries for this model
            if model == FALLBACK_MODEL:
                raise Exception(f"All models exhausted. Last error: {last_err}")
            # else continue to fallback model

    raise Exception("Gemini call failed across all models")
