"""
Backward-compatible shim — re-exports everything from the db/ package.

All code that does `from database import X` continues to work unchanged.
New code should import directly from db submodules:
    from db.connection import get_db
    from db.history import db_get_history
    etc.
"""

# Re-export everything from the db package
from db import *  # noqa: F401,F403
