"""Regression tests for DMS session recovery.

The original bug: a keepalive tab whose DMS session had silently expired was
handed straight to automation tasks. The task then waited 30s for
``#SearchType`` and crashed with a Playwright timeout. These tests pin the
behaviour that a dead session is detected, discarded and re-created.
"""

import asyncio

import pytest

from app.core.session_manager import SessionManager


class FakePage:
    def __init__(self, redirect_to=None, has_selector=True, goto_error=None):
        self.url = "about:blank"
        self.redirect_to = redirect_to
        self.has_selector = has_selector
        self.goto_error = goto_error
        self.closed = False
        self.goto_calls = []

    async def goto(self, url, **kwargs):
        self.goto_calls.append(url)
        if self.goto_error:
            raise self.goto_error
        self.url = self.redirect_to or url

    async def wait_for_selector(self, selector, **kwargs):
        if not self.has_selector:
            raise TimeoutError(f"selector not found: {selector}")
        return object()

    async def content(self):
        return "<html><body>maintenance</body></html>"

    async def close(self):
        self.closed = True


class FakeContext:
    def __init__(self):
        self.closed = False

    async def new_page(self):
        return FakePage()

    async def close(self):
        self.closed = True


class FakeBrowser:
    async def new_context(self, **kwargs):
        return FakeContext()


async def test_check_session_valid():
    manager = SessionManager()
    assert await manager._check_session(FakePage()) == "valid"


async def test_check_session_detects_login_redirect():
    manager = SessionManager()
    page = FakePage(redirect_to="https://blkdms.banglalink.net/Account/Login")
    assert await manager._check_session(page) == "login"


async def test_check_session_keeps_file_on_unknown_failure():
    manager = SessionManager()
    assert await manager._check_session(FakePage(goto_error=TimeoutError("slow"))) == "unknown"
    assert await manager._check_session(FakePage(has_selector=False)) == "unknown"


async def test_open_authenticated_page_relogs_after_login_redirect(monkeypatch):
    manager = SessionManager()
    dead_page = FakePage(redirect_to="https://blkdms.banglalink.net/Account/Login")
    live_page = FakePage()
    responses = iter([(dead_page, None), (live_page, None)])
    invalidated = []

    async def fake_get_valid_page(credentials, attempts=2):
        return next(responses)

    async def fake_invalidate(credentials, drop_file=True):
        invalidated.append(drop_file)

    monkeypatch.setattr(manager, "get_valid_page", fake_get_valid_page)
    monkeypatch.setattr(manager, "_invalidate_session", fake_invalidate)

    page, context = await manager.open_authenticated_page(
        {"house_name": "RYZBRB01", "code": "RYZBRB01", "house_id": 1},
        "https://blkdms.banglalink.net/SmartSearchReport",
    )

    assert page is live_page
    assert context is None
    assert dead_page.closed is True
    assert invalidated == [True]


async def test_open_authenticated_page_keeps_saved_state_on_transient_failure(monkeypatch):
    manager = SessionManager()
    slow_page = FakePage(has_selector=False)
    live_page = FakePage()
    responses = iter([(slow_page, None), (live_page, None)])
    invalidated = []

    async def fake_get_valid_page(credentials, attempts=2):
        return next(responses)

    async def fake_invalidate(credentials, drop_file=True):
        invalidated.append(drop_file)

    monkeypatch.setattr(manager, "get_valid_page", fake_get_valid_page)
    monkeypatch.setattr(manager, "_invalidate_session", fake_invalidate)

    page, _ = await manager.open_authenticated_page(
        {"house_name": "RYZBRB01", "code": "RYZBRB01", "house_id": 1},
        "https://blkdms.banglalink.net/SmartSearchReport",
    )

    assert page is live_page
    assert slow_page.closed is True
    assert invalidated == [False]


async def test_get_valid_page_rejects_expired_keepalive_and_relogs(monkeypatch, tmp_path):
    manager = SessionManager()
    manager.browser = FakeBrowser()

    dead_keepalive_page = FakePage(redirect_to="https://blkdms.banglalink.net/Account/Login")
    keepalive_context = FakeContext()
    keepalive_context.new_page = lambda: _async(dead_keepalive_page)

    async def _never():
        await asyncio.sleep(3600)

    keepalive_task = asyncio.create_task(_never())
    manager._keepalive_ctx["RYZBRB01"] = {
        "context": keepalive_context,
        "page": FakePage(),
        "task": keepalive_task,
    }

    session_file = tmp_path / "RYZBRB01.json"
    session_file.write_text("{}")

    fresh_page = FakePage()
    fresh_context = FakeContext()

    async def fake_login(credentials):
        return fresh_page, fresh_context

    monkeypatch.setattr(manager, "_session_path", lambda credentials: str(session_file))
    monkeypatch.setattr(manager, "_login", fake_login)

    page, context = await manager._get_valid_page_inner(
        {"house_name": "RYZBRB01", "code": "RYZBRB01", "house_id": 1}
    )

    assert page is fresh_page
    assert context is fresh_context
    assert dead_keepalive_page.closed is True
    assert keepalive_context.closed is True
    assert "RYZBRB01" not in manager._keepalive_ctx
    assert not session_file.exists()


async def _async(value):
    return value
