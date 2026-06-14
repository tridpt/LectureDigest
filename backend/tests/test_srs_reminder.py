"""
Tests for SRS email reminder routes — preference toggle and due-card counting.
No real emails are sent (email_sender falls back to logging when unconfigured).
"""

import json
import time
from datetime import datetime

import pytest


class TestReminderPreferenceAuth:
    """All reminder endpoints require authentication."""

    def test_get_preference_requires_auth(self, client):
        assert client.get("/api/srs-reminder/preference").status_code == 401

    def test_set_preference_requires_auth(self, client):
        assert client.post("/api/srs-reminder/preference", json={"enabled": True}).status_code == 401

    def test_test_endpoint_requires_auth(self, client):
        assert client.post("/api/srs-reminder/test").status_code == 401


class TestReminderPreferenceToggle:
    """Enabling/disabling the reminder preference persists and reflects back."""

    def test_default_disabled(self, client, auth_headers):
        resp = client.get("/api/srs-reminder/preference", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["enabled"] is False
        assert "due_count" in data
        assert "smtp_configured" in data

    def test_enable_then_disable(self, client, auth_headers):
        on = client.post("/api/srs-reminder/preference", json={"enabled": True}, headers=auth_headers)
        assert on.status_code == 200 and on.json()["enabled"] is True
        # Reflected on GET
        assert client.get("/api/srs-reminder/preference", headers=auth_headers).json()["enabled"] is True

        off = client.post("/api/srs-reminder/preference", json={"enabled": False}, headers=auth_headers)
        assert off.status_code == 200 and off.json()["enabled"] is False
        assert client.get("/api/srs-reminder/preference", headers=auth_headers).json()["enabled"] is False


class TestDueCardCounting:
    """due_count reflects synced SM-2 data in the KV store."""

    def test_due_count_counts_due_cards(self, client, registered_user):
        user, token, headers = registered_user
        # Seed SM-2 data via the sync KV store: one due (past) + one future card.
        from database import db_kv_set
        today = datetime.now().strftime("%Y-%m-%d")
        cards = {
            "card_1": {"nextReview": "2000-01-01"},   # past → due
            "card_2": {"nextReview": "2999-12-31"},   # future → not due
            "card_3": {},                              # no schedule → due
        }
        db_kv_set(user["id"], "lectureDigest_sm2_vid123", json.dumps(cards))

        resp = client.get("/api/srs-reminder/preference", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["due_count"] == 2

    def test_no_cards_means_zero_due(self, client, auth_headers):
        resp = client.get("/api/srs-reminder/preference", headers=auth_headers)
        assert resp.json()["due_count"] == 0


class TestTestEndpointRateLimit:
    """The /test endpoint sends a real email, so it is rate-limited per user."""

    def test_test_endpoint_rate_limited(self, client, auth_headers):
        # Email is unconfigured in tests, so sends fall back to logging (200 OK).
        # Allowed budget is 3/hour; the 4th call must be rejected with 429.
        statuses = []
        for _ in range(5):
            statuses.append(client.post("/api/srs-reminder/test", headers=auth_headers).status_code)
        assert statuses[:3] == [200, 200, 200], statuses
        assert 429 in statuses[3:], statuses
