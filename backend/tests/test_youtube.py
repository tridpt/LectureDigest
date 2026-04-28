"""
Unit tests for YouTube utilities — no network calls needed.
"""

import pytest
from youtube import extract_video_id, format_seconds, extract_playlist_id


class TestExtractVideoId:
    """Test extract_video_id with various YouTube URL formats."""

    def test_standard_url(self):
        assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_short_url(self):
        assert extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_embed_url(self):
        assert extract_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_shorts_url(self):
        assert extract_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_raw_video_id(self):
        assert extract_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_url_with_extra_params(self):
        assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120&list=PLxxx") == "dQw4w9WgXcQ"

    def test_invalid_url_raises(self):
        with pytest.raises(ValueError, match="Invalid YouTube URL"):
            extract_video_id("https://google.com/notavideo")

    def test_empty_string_raises(self):
        with pytest.raises(ValueError):
            extract_video_id("")

    def test_too_short_id_raises(self):
        with pytest.raises(ValueError):
            extract_video_id("abc")


class TestFormatSeconds:
    """Test format_seconds timestamp formatter."""

    def test_zero(self):
        assert format_seconds(0) == "0:00"

    def test_under_minute(self):
        assert format_seconds(45) == "0:45"

    def test_exact_minute(self):
        assert format_seconds(60) == "1:00"

    def test_minutes_and_seconds(self):
        assert format_seconds(125) == "2:05"

    def test_over_hour(self):
        assert format_seconds(3661) == "1:01:01"

    def test_exact_hour(self):
        assert format_seconds(3600) == "1:00:00"

    def test_float_input(self):
        assert format_seconds(90.7) == "1:30"

    def test_large_value(self):
        assert format_seconds(7384) == "2:03:04"


class TestExtractPlaylistId:
    """Test playlist ID extraction from URLs."""

    def test_standard_playlist_url(self):
        assert extract_playlist_id("https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf") == "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"

    def test_video_with_playlist(self):
        assert extract_playlist_id("https://www.youtube.com/watch?v=abc&list=PLxyz123") == "PLxyz123"

    def test_no_playlist_raises(self):
        with pytest.raises(ValueError, match="Invalid YouTube playlist URL"):
            extract_playlist_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
