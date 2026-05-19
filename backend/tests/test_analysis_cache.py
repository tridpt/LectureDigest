"""
Tests for the analysis cache system.
"""

import pytest
from database import db_get_analysis_cache, db_set_analysis_cache, db_delete_analysis_cache


class TestAnalysisCache:
    """Test cache get/set/delete operations."""

    def test_cache_miss(self):
        result = db_get_analysis_cache("nonexistent_video", "English")
        assert result is None

    def test_cache_set_and_get(self):
        test_result = {
            "title": "Test Video",
            "author": "Test Author",
            "overview": "A test overview",
            "quiz": [{"id": 1, "question": "Q?"}],
            "video_id": "test123",
        }
        db_set_analysis_cache("test123", "English", test_result)

        cached = db_get_analysis_cache("test123", "English")
        assert cached is not None
        assert cached["title"] == "Test Video"
        assert cached["video_id"] == "test123"
        assert len(cached["quiz"]) == 1

    def test_cache_different_languages(self):
        db_set_analysis_cache("vid_lang", "English", {"title": "English Title"})
        db_set_analysis_cache("vid_lang", "Vietnamese", {"title": "Tiêu đề Việt"})

        en = db_get_analysis_cache("vid_lang", "English")
        vi = db_get_analysis_cache("vid_lang", "Vietnamese")

        assert en["title"] == "English Title"
        assert vi["title"] == "Tiêu đề Việt"

    def test_cache_overwrite(self):
        db_set_analysis_cache("overwrite_vid", "English", {"title": "Old"})
        db_set_analysis_cache("overwrite_vid", "English", {"title": "New"})

        cached = db_get_analysis_cache("overwrite_vid", "English")
        assert cached["title"] == "New"

    def test_cache_delete_specific_language(self):
        db_set_analysis_cache("del_vid", "English", {"title": "EN"})
        db_set_analysis_cache("del_vid", "Vietnamese", {"title": "VI"})

        db_delete_analysis_cache("del_vid", "English")

        assert db_get_analysis_cache("del_vid", "English") is None
        assert db_get_analysis_cache("del_vid", "Vietnamese") is not None

    def test_cache_delete_all_languages(self):
        db_set_analysis_cache("del_all", "English", {"title": "EN"})
        db_set_analysis_cache("del_all", "Vietnamese", {"title": "VI"})

        db_delete_analysis_cache("del_all")

        assert db_get_analysis_cache("del_all", "English") is None
        assert db_get_analysis_cache("del_all", "Vietnamese") is None

    def test_cache_unicode_content(self):
        """Ensure Vietnamese/Unicode content is stored correctly."""
        test_result = {
            "title": "Học lập trình Python cơ bản",
            "overview": "Bài giảng về Python cho người mới bắt đầu 🐍",
        }
        db_set_analysis_cache("unicode_vid", "Vietnamese", test_result)

        cached = db_get_analysis_cache("unicode_vid", "Vietnamese")
        assert cached["title"] == "Học lập trình Python cơ bản"
        assert "🐍" in cached["overview"]
