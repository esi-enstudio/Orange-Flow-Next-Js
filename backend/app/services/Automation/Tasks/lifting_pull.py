"""Automate a Banglalink DMS PreRF lifting request.

Flow (as specified by the business):
1. Open /PreRF and read the Product Status column.
2. Pending rows (or a latest Rejected row) block a new request.
3. Otherwise open /PreRF/Create, pick the warehouse and bank, and check the
   distributor's **Available Amount** on the cash account (the
   "Payable -Cash Account" / ``…/PCA`` row):
   - a pull of N iTopUp consumes ``N * 0.9625`` (the 3.75% lifting price), so
     that balance must cover ``iTopUp * 0.9625``;
   - the record may instead pull the whole balance, ``available / 0.9625``
     iTopUp — the user explicitly agrees to that in the UI.
4. Fill today's deposit date, the lifting bank deposit and the uploaded slip,
   then add i'top up with the resolved integer quantity.
5. Read the calculated Total Price, paste it into the requisition amount and
   verify the remaining requisition sum becomes zero.
6. Save and wait for DMS's success confirmation.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import mimetypes
import os
import re
import time
from decimal import Decimal, ROUND_DOWN
from typing import Callable, Optional

from playwright.async_api import Page

from app.constants.dms import (
    DMS_PRERF_CREATE_URL,
    DMS_PRERF_ITOPUP_PRODUCT_ID,
    DMS_PRERF_ITOPUP_UNIT_PRICE,
    DMS_PRERF_URL,
    DMS_PRERF_WAREHOUSE_ID,
)
from app.core.session_manager import session_manager
from app.services.Automation.dms_scraper import (
    evaluate_pre_rf_rows,
    get_pre_rf_account_rows,
    get_pre_rf_rows,
)
from app.utils.timezone import now_naive

logger = logging.getLogger("app.services.Automation.Tasks.lifting_pull")

ProgressCallback = Optional[Callable[..., None]]


class LiftingPullError(Exception):
    """A step-specific failure that should be shown to the user as-is."""


def _progress(cb: ProgressCallback, code: str, message: str, **params) -> None:
    if cb is None:
        return
    try:
        cb(code, message, params)
    except Exception:
        logger.debug("PreRF progress callback failed", exc_info=True)


def floor_quantity(value: float) -> int:
    """DMS Req. Qty must be a whole number; truncate the decimal part."""
    return int(Decimal(str(value or 0)).to_integral_value(rounding=ROUND_DOWN))


def _parse_number(raw: str) -> float:
    cleaned = re.sub(r"[^0-9.\-]", "", (raw or "").replace(",", ""))
    try:
        return float(cleaned)
    except Exception:
        return 0.0


# ── DMS cash account balance ──
# The requisition is paid from the distributor's "Payable -Cash Account", whose
# DMS code always ends with ``/PCA`` (e.g. ``MYMVAI01/PCA``).
CASH_ACCOUNT_CODE_SUFFIX = "/PCA"


def pick_cash_account_row(rows: list[dict]) -> Optional[dict]:
    """The Payable Cash Account row of the PreRF A/C table."""
    for row in rows:
        if (row.get("code") or "").upper().endswith(CASH_ACCOUNT_CODE_SUFFIX):
            return row
    for row in rows:
        name = (row.get("name") or "").lower()
        if "cash" in name and "payable" in name:
            return row
    for row in rows:
        if "cash" in (row.get("name") or "").lower():
            return row
    return None


async def read_prf_funds(page: Page) -> dict:
    """Available requisition balance of the distributor's DMS cash account."""
    rows = await get_pre_rf_account_rows(page)
    if not rows:
        raise LiftingPullError(
            "The DMS account balance table was not found on the PreRF create page."
        )
    row = pick_cash_account_row(rows)
    if row is None:
        raise LiftingPullError(
            "The DMS cash account (Payable -Cash Account) was not found on the "
            "PreRF create page."
        )
    return {
        "account_name": row.get("name") or "",
        "account_code": row.get("code") or "",
        "available_amount": round(float(row.get("available") or 0.0), 4),
    }


def _itopup_cash(quantity: int) -> float:
    """Cash a requisition for ``quantity`` iTopUp consumes in DMS."""
    return float(Decimal(quantity) * Decimal(str(DMS_PRERF_ITOPUP_UNIT_PRICE)))


def _max_itopup_quantity(available_amount: float) -> int:
    """Largest iTopUp quantity the available balance can pay for."""
    unit = Decimal(str(DMS_PRERF_ITOPUP_UNIT_PRICE))
    if unit <= 0:
        return 0
    return int(
        (Decimal(str(available_amount or 0)) / unit).to_integral_value(
            rounding=ROUND_DOWN
        )
    )


def pull_funds_summary(available_amount: float, itopup_amount: float) -> dict:
    """Compare the record's iTopUp pull with the DMS cash balance.

    DMS pays the i'top up product at the 3.75% lifting price, so a pull of N
    iTopUp consumes ``N * 0.9625`` of the cash account. When the account holds
    more than that, the whole balance can be pulled instead:
    ``available / 0.9625`` iTopUp.
    """
    available = round(float(available_amount or 0), 4)
    quantity = floor_quantity(itopup_amount)
    required = round(_itopup_cash(quantity), 4)
    max_quantity = _max_itopup_quantity(available)
    return {
        "available_amount": available,
        "required_amount": required,
        "itopup_quantity": quantity,
        "sufficient": available >= required,
        "extra_amount": round(max(0.0, available - required), 4),
        "max_itopup_quantity": max_quantity,
        "max_total_price": round(_itopup_cash(max_quantity), 4),
    }


def insufficient_balance_result(summary: dict) -> dict:
    """Result for a pull the DMS cash balance cannot pay for.

    Nothing has been typed into DMS at this point, so the pull stops and the UI
    reports the exact shortfall instead of a generic failure.
    """
    available = summary["available_amount"]
    required = summary["required_amount"]
    shortfall = round(max(0.0, float(required) - float(available)), 4)
    return {
        "outcome": "insufficient_balance",
        "message": (
            "The DMS cash account does not have enough balance for this pull "
            f"(available: {available}, required: {required}, "
            f"short by: {shortfall}). "
            "The process was stopped before any requisition was created."
        ),
        "available_amount": available,
        "required_amount": required,
        "shortfall_amount": shortfall,
    }


async def check_lifting_pull_funds(*, credentials: dict, record: dict) -> dict:
    """Read the DMS cash balance and compare it with the record's iTopUp pull.

    Runs standalone (before the pull job starts) so the UI can block a pull the
    balance cannot pay for and offer to pull the whole available balance.
    """
    page: Optional[Page] = None
    try:
        page, _context = await session_manager.get_valid_page(credentials)
        await page.goto(DMS_PRERF_CREATE_URL, wait_until="domcontentloaded", timeout=60000)
        if "login" in (page.url or "").lower():
            raise LiftingPullError("DMS session expired. Please reconnect the DMS session.")

        funds = await read_prf_funds(page)
        summary = pull_funds_summary(
            funds["available_amount"], record.get("itopup_amount")
        )
        summary.update(
            {
                "account_name": funds["account_name"],
                "account_code": funds["account_code"],
            }
        )
        return summary
    finally:
        if page:
            try:
                await page.close()
            except Exception:
                pass


def decode_deposit_slip(slip: Optional[str]) -> tuple[bytes, str, str]:
    """Decode a stored lifting slip into bytes, MIME type and filename.

    The UI stores a browser-compressed data URL. Absolute/relative file paths
    are also accepted for older records.
    """
    if not slip or not isinstance(slip, str):
        raise LiftingPullError("This lifting record has no bank deposit slip.")

    if slip.startswith("data:"):
        header, _, payload = slip.partition(",")
        if not payload:
            raise LiftingPullError("The stored bank deposit slip is empty.")
        mime = "image/jpeg"
        if header.startswith("data:") and ";" in header:
            mime = header[5:].split(";", 1)[0] or "image/jpeg"
        try:
            raw = base64.b64decode(payload)
        except Exception as exc:
            raise LiftingPullError(f"Could not decode the bank deposit slip: {exc}") from exc
        ext = mimetypes.guess_extension(mime) or ".jpg"
        if ext == ".jpe":
            ext = ".jpg"
        return raw, mime, f"deposit_slip{ext}"

    # Older records may contain a plain base64 string or a local file path.
    try:
        raw = base64.b64decode(slip, validate=True)
        if raw:
            return raw, "image/jpeg", "deposit_slip.jpg"
    except Exception:
        pass

    candidates = [
        slip,
        os.path.join(os.getcwd(), slip.lstrip("/")),
        os.path.join(os.getcwd(), "backend", slip.lstrip("/")),
        os.path.join(os.getcwd(), "uploads", slip.lstrip("/")),
    ]
    for candidate in candidates:
        if os.path.isfile(candidate):
            mime = mimetypes.guess_type(candidate)[0] or "image/jpeg"
            with open(candidate, "rb") as fh:
                return fh.read(), mime, os.path.basename(candidate)

    raise LiftingPullError("The stored bank deposit slip could not be read.")


async def _fill_and_blur(page: Page, selector: str, value: str) -> None:
    """Fill a DMS text/date field like a real user and blur it.

    Real events always carry a valid ``event.target``. DMS's inline handlers
    (e.g. ``ValidateInput(event)``) throw when the handler is invoked manually
    with a synthetic event, so never call ``el.onblur()``/``el.onchange()``
    directly. Readonly fields fall back to a JS set that still dispatches
    proper events.
    """
    try:
        await page.fill(selector, value)
        await page.locator(selector).blur()
        return
    except Exception:
        logger.info("Real fill failed for %s; falling back to a JS value set.", selector)
    await page.evaluate(
        """([selector, value]) => {
            const el = document.querySelector(selector);
            if (!el) throw new Error(`Field not found: ${selector}`);
            el.value = value;
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
            el.dispatchEvent(new Event('blur', {bubbles: true}));
            if (window.jQuery) window.jQuery(el).trigger('change');
        }""",
        [selector, value],
    )


async def _select_value(page: Page, selector: str, value: str) -> None:
    await page.select_option(selector, value)
    await page.evaluate(
        """(selector) => {
            const el = document.querySelector(selector);
            if (el) {
                el.dispatchEvent(new Event('input', {bubbles: true}));
                el.dispatchEvent(new Event('change', {bubbles: true}));
                if (window.jQuery) window.jQuery(el).trigger('change');
            }
        }""",
        selector,
    )


async def _select_bank(page: Page, bank_id: Optional[int], bank_name: Optional[str]) -> None:
    selected = False
    if bank_name:
        try:
            await page.select_option("#BankId", label=bank_name)
            selected = True
        except Exception:
            selected = False
    if not selected and bank_id:
        try:
            await _select_value(page, "#BankId", str(bank_id))
            selected = True
        except Exception:
            selected = False
    if not selected:
        raise LiftingPullError(
            f"The selected bank ({bank_name or bank_id}) was not found on the DMS form."
        )
    await page.evaluate(
        """() => {
            const el = document.querySelector('#BankId');
            if (el) {
                el.dispatchEvent(new Event('change', {bubbles: true}));
                if (window.jQuery) window.jQuery(el).trigger('change');
            }
        }"""
    )
    # Selecting a bank normally fills Account No from the distributor's DMS
    # profile. Give the page a moment, but do not fail if DMS leaves it blank.
    try:
        await page.wait_for_function(
            "() => { const el = document.querySelector('#AccountNo'); return el && el.value.trim().length > 0; }",
            timeout=8000,
        )
    except Exception:
        logger.info("DMS did not auto-fill Account No after bank selection; continuing.")


async def _select_promotion(page: Page) -> None:
    """Ensure the promotion matching the i'top up product is selected."""
    try:
        await page.wait_for_function(
            "() => { const el = document.querySelector('#Promotion'); return el && el.options.length > 1; }",
            timeout=15000,
        )
    except Exception:
        pass

    current = (await page.input_value("#Promotion")) if await page.query_selector("#Promotion") else ""
    if current and current != "0":
        return

    promo_value = await page.evaluate(
        """() => {
            const opt = document.querySelector('option.Promotion_35');
            return opt ? opt.value : '';
        }"""
    )
    if promo_value:
        await _select_value(page, "#Promotion", str(promo_value))
        return

    # Last resort: choose the first real promotion option.
    await page.evaluate(
        """() => {
            const el = document.querySelector('#Promotion');
            if (!el) return;
            const opt = Array.from(el.options).find(o => o.value && o.value !== '0');
            if (opt) {
                el.value = opt.value;
                el.dispatchEvent(new Event('change', {bubbles: true}));
                if (window.jQuery) window.jQuery(el).trigger('change');
            }
        }"""
    )


def _read_total_price_js() -> str:
    return """() => {
        const table = document.querySelector('#customTable');
        if (!table) return '';
        const headers = Array.from(table.querySelectorAll('thead th'));
        let index = headers.findIndex(th => th.textContent.toLowerCase().includes('total price'));
        if (index < 0) index = headers.length - 2;
        const rows = table.querySelectorAll('tbody tr');
        if (!rows.length) return '';
        const cells = rows[rows.length - 1].querySelectorAll('td');
        if (!cells.length) return '';
        const cell = cells[Math.min(index, cells.length - 1)];
        return cell ? cell.textContent.trim() : '';
    }"""


async def _wait_for_save_outcome(page: Page, dialogs: list[str], timeout: int = 90) -> tuple[str, str]:
    """Wait for the DMS save result.

    Returns ``(result, message)`` where result is ``success``, ``error`` or
    ``unknown``. Common DMS success modals (``#okBtn`` / SweetAlert2) and
    validation popups are handled here.
    """
    deadline = time.time() + timeout
    checked_dialogs = 0

    while time.time() < deadline:
        # Native browser dialogs captured by the page handler.
        while checked_dialogs < len(dialogs):
            message = dialogs[checked_dialogs].strip()
            checked_dialogs += 1
            lowered = message.lower()
            if any(word in lowered for word in ("success", "successfully", "submitted")):
                return "success", message
            if any(word in lowered for word in ("error", "failed", "invalid", "not enough", "insufficient")):
                return "error", message

        for selector in (".swal2-popup", ".modal.show", ".modal.in", "#successModal", ".alert-success"):
            try:
                locator = page.locator(selector).first
                if await locator.count() == 0 or not await locator.is_visible():
                    continue
                text = (await locator.inner_text()).strip()
                if not text:
                    continue
                lowered = text.lower()
                if any(word in lowered for word in ("success", "successfully", "submitted", "saved")):
                    await _close_success_modal(page)
                    return "success", text
                if any(word in lowered for word in ("error", "failed", "invalid", "not enough", "insufficient")):
                    return "error", text
                if any(word in lowered for word in ("are you sure", "do you want", "confirm", "yes")):
                    await _click_first(
                        page,
                        (
                            "button.swal2-confirm",
                            ".modal.show button.btn-primary",
                            ".modal.show button.btn-success",
                            ".modal.show button[type='submit']",
                        ),
                    )
                    await asyncio.sleep(1)
                    break
            except Exception:
                continue

        # Some DMS confirmation pages use #okBtn only.
        try:
            ok = page.locator("#okBtn").first
            if await ok.count() and await ok.is_visible():
                await ok.click()
                return "success", "DMS success confirmation shown."
        except Exception:
            pass

        await asyncio.sleep(1)

    return "unknown", "DMS did not show a success confirmation within the timeout."


async def _click_first(page: Page, selectors: tuple[str, ...]) -> bool:
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if await locator.count() and await locator.is_visible():
                await locator.click()
                return True
        except Exception:
            continue
    return False


async def _close_success_modal(page: Page) -> None:
    await _click_first(
        page,
        (
            "#okBtn",
            "button.swal2-confirm",
            ".modal.show button[data-dismiss='modal']",
            ".modal.show button.btn-primary",
        ),
    )


async def _capture_rf_code(page: Page, before_rows: list[dict]) -> dict:
    """Re-read the PreRF list and identify the newly created request."""
    try:
        await page.goto(DMS_PRERF_URL, wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(1)
    except Exception:
        return {}
    rows, error = await get_pre_rf_rows(page)
    if error or not rows:
        return {}
    before = {row.get("rf_code") for row in before_rows}
    for row in rows:
        if row.get("rf_code") not in before:
            return row
    return rows[0] if rows else {}


async def run_lifting_pre_rf_pull(
    *,
    credentials: dict,
    record: dict,
    progress: ProgressCallback = None,
    dry_run: bool = False,
) -> dict:
    """Run the full PreRF flow and return a structured result dict."""
    house_name = credentials.get("house_name") or credentials.get("code") or "DMS"
    page: Optional[Page] = None
    dialogs: list[str] = []
    base_result = {
        "outcome": "failed",
        "message": "",
        "rf_code": None,
        "rf_date": None,
        "rf_status": None,
        "total_price": None,
        "requisition_sum": None,
        "pulled_quantity": None,
        "available_amount": None,
        "dry_run": dry_run,
    }

    async def on_dialog(dialog):
        try:
            dialogs.append(dialog.message or "")
            await dialog.accept()
        except Exception:
            pass

    try:
        _progress(progress, "connecting", "Connecting to DMS...")
        page, _context = await session_manager.get_valid_page(credentials)
        page.on("dialog", lambda d: asyncio.create_task(on_dialog(d)))

        _progress(progress, "checking_pre_rf", "Checking existing PreRF requests...")
        await page.goto(DMS_PRERF_URL, wait_until="domcontentloaded", timeout=60000)
        await asyncio.sleep(1)

        rows, rows_error = await get_pre_rf_rows(page)
        if rows_error:
            raise LiftingPullError(rows_error)

        evaluation = evaluate_pre_rf_rows(rows)
        if evaluation["blocked"]:
            row = evaluation["row"] or {}
            outcome = evaluation["outcome"]
            if outcome == "blocked_pending":
                _progress(
                    progress,
                    "pre_rf_pending",
                    "A PreRF request is already pending.",
                    rf_code=row.get("rf_code"),
                    rf_date=row.get("rf_date"),
                )
                base_result.update(
                    {
                        "outcome": outcome,
                        "message": (
                            "A PreRF request is already Pending for this distributor. "
                            "A new request cannot be created until it is resolved."
                        ),
                        "rf_code": row.get("rf_code"),
                        "rf_date": row.get("rf_date"),
                        "rf_status": row.get("status"),
                    }
                )
            else:
                _progress(
                    progress,
                    "pre_rf_rejected",
                    "The latest PreRF request was rejected.",
                    rf_code=row.get("rf_code"),
                    rf_date=row.get("rf_date"),
                )
                base_result.update(
                    {
                        "outcome": outcome,
                        "message": (
                            "The latest PreRF request was Rejected. "
                            "A new request cannot be created until the rejection is resolved."
                        ),
                        "rf_code": row.get("rf_code"),
                        "rf_date": row.get("rf_date"),
                        "rf_status": row.get("status"),
                    }
                )
            return base_result

        _progress(progress, "opening_create", "Opening the PreRF create form...")
        await page.goto(DMS_PRERF_CREATE_URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_selector("#WarehouseId", state="attached", timeout=30000)
        if "login" in (page.url or "").lower():
            raise LiftingPullError("DMS session expired. Please reconnect the DMS session.")

        _progress(progress, "selecting_warehouse", "Selecting the warehouse...")
        await _select_value(page, "#WarehouseId", str(DMS_PRERF_WAREHOUSE_ID))

        _progress(progress, "selecting_bank", "Selecting the bank...")
        await page.wait_for_selector("#BankId", state="attached", timeout=20000)
        await _select_bank(page, record.get("bank_id"), record.get("bank_name"))

        # The requisition is paid from the DMS cash account: a pull of N iTopUp
        # consumes N * 0.9625, so that balance must cover it. Read it with the
        # form already settled, so the numbers match the requisition below.
        funds = await read_prf_funds(page)
        summary = pull_funds_summary(
            funds["available_amount"], record.get("itopup_amount")
        )
        base_result["available_amount"] = summary["available_amount"]
        _progress(
            progress,
            "checking_balance",
            "Checking the DMS cash account balance...",
            available_amount=summary["available_amount"],
            required_amount=summary["required_amount"],
            extra_amount=summary["extra_amount"],
        )
        if record.get("use_available_balance"):
            # The user agreed to pull the whole available balance.
            quantity = summary["max_itopup_quantity"]
            if quantity < 1:
                # An empty cash account cannot pay for anything: stop before the
                # deposit/product form is filled, with the numbers the user
                # needs to fix it.
                base_result.update(insufficient_balance_result(summary))
                _progress(
                    progress,
                    "insufficient_balance",
                    base_result["message"],
                    available_amount=base_result["available_amount"],
                    required_amount=base_result["required_amount"],
                    shortfall_amount=base_result["shortfall_amount"],
                )
                return base_result
        else:
            quantity = summary["itopup_quantity"]
            if quantity < 1:
                raise LiftingPullError("The iTopUp amount on this lifting record is less than 1.")
            if not summary["sufficient"]:
                # Not enough cash for this pull: stop here (nothing has been
                # typed into DMS yet) and report the exact shortfall.
                base_result.update(insufficient_balance_result(summary))
                _progress(
                    progress,
                    "insufficient_balance",
                    base_result["message"],
                    available_amount=base_result["available_amount"],
                    required_amount=base_result["required_amount"],
                    shortfall_amount=base_result["shortfall_amount"],
                )
                return base_result

        _progress(progress, "filling_deposit", "Filling the bank deposit information...")
        today = now_naive().date().isoformat()
        # Real fill + blur so DMS's inline handlers (ValidateInput(event))
        # receive a proper event target. Calling el.onblur()/el.onchange()
        # directly leaves event.target null and crashes the page handlers.
        await _fill_and_blur(page, "#DepositDate", today)
        deposit_amount = float(record.get("total_bank_deposit") or 0)
        await _fill_and_blur(page, "#DepositAmount", f"{deposit_amount:.2f}")

        _progress(progress, "uploading_slip", "Uploading the bank deposit slip...")
        slip_bytes, slip_mime, slip_name = decode_deposit_slip(record.get("deposit_slip"))
        await page.set_input_files(
            "#DepositSlip",
            {"name": slip_name, "mimeType": slip_mime, "buffer": slip_bytes},
        )

        _progress(progress, "adding_product", "Adding the i'top up product...")
        await page.wait_for_selector("#Product", state="attached", timeout=20000)
        try:
            await _select_value(page, "#Product", str(DMS_PRERF_ITOPUP_PRODUCT_ID))
        except Exception:
            await page.evaluate(
                """() => {
                    const sel = document.querySelector('#Product');
                    if (!sel) return;
                    const opt = Array.from(sel.options).find(o =>
                        /i.?top\\s*up/i.test(o.textContent) && !/swap/i.test(o.textContent)
                    );
                    if (opt) {
                        sel.value = opt.value;
                        sel.dispatchEvent(new Event('change', {bubbles: true}));
                        if (window.jQuery) window.jQuery(sel).trigger('change');
                    }
                }"""
            )
        await _select_promotion(page)

        await page.wait_for_selector("#requestedQty", state="attached", timeout=20000)
        qty_input = page.locator("#requestedQty").first
        # Type the quantity like a real user: DMS enables Add Product from
        # keyup/input handlers, and a real blur fires change + onblur with a
        # valid event target.
        try:
            await qty_input.fill("")
            await qty_input.press_sequentially(str(quantity), delay=30)
            await qty_input.blur()
        except Exception:
            logger.info("Real typing failed for #requestedQty; falling back to a JS value set.")
            await page.evaluate(
                """(qty) => {
                    const el = document.querySelector('#requestedQty');
                    if (!el) throw new Error('Field not found: #requestedQty');
                    el.value = qty;
                    el.dispatchEvent(new Event('input', {bubbles: true}));
                    el.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true}));
                    el.dispatchEvent(new Event('change', {bubbles: true}));
                    el.dispatchEvent(new Event('blur', {bubbles: true}));
                    if (window.jQuery) window.jQuery(el).trigger('change');
                }""",
                str(quantity),
            )

        await page.wait_for_selector("#addProductBtn:not([disabled])", state="visible", timeout=20000)
        await page.click("#addProductBtn")
        await asyncio.sleep(1.5)

        _progress(progress, "verifying_requisition", "Verifying the requisition amount...")
        try:
            await page.wait_for_selector("#customTable tbody tr", state="attached", timeout=30000)
        except Exception:
            raise LiftingPullError("DMS did not add the i'top up product to the requisition list.")

        total_price_raw = await page.evaluate(_read_total_price_js())
        total_price = _parse_number(total_price_raw)
        if total_price <= 0:
            raise LiftingPullError("Could not read the Total Price from the DMS product list.")

        # The requisition amount input is generated per product row.
        try:
            await page.wait_for_selector(
                "input.requisitionAmount, input[onkeyup*='ValidateRequisitionAmount']",
                state="attached",
                timeout=20000,
            )
        except Exception:
            raise LiftingPullError("The DMS requisition amount field was not found.")

        req_input = page.locator(
            "input.requisitionAmount, input[onkeyup*='ValidateRequisitionAmount']"
        ).first
        req_value = re.sub(r"[^0-9.]", "", total_price_raw or "") or f"{total_price:.4f}"
        try:
            await req_input.fill(req_value)
            await req_input.dispatch_event("keyup")
            await req_input.dispatch_event("change")
            await req_input.dispatch_event("blur")
        except Exception:
            logger.info("Real fill failed for the requisition input; falling back to a JS value set.")
            await page.evaluate(
                """(value) => {
                    const el = document.querySelector('input.requisitionAmount')
                        || document.querySelector("input[onkeyup*='ValidateRequisitionAmount']");
                    if (!el) throw new Error('Requisition amount field not found');
                    el.value = value;
                    el.dispatchEvent(new Event('input', {bubbles: true}));
                    el.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true}));
                    el.dispatchEvent(new Event('change', {bubbles: true}));
                    el.dispatchEvent(new Event('blur', {bubbles: true}));
                    if (window.jQuery) window.jQuery(el).trigger('change');
                }""",
                req_value,
            )
        await asyncio.sleep(1.5)

        sum_locator = page.locator("#requisitionSum").first
        if await sum_locator.count() == 0:
            raise LiftingPullError("The DMS remaining requisition amount was not found.")
        requisition_sum = _parse_number(await sum_locator.inner_text())
        _progress(
            progress,
            "verifying_requisition",
            "Checking the remaining requisition amount...",
            total_price=total_price,
            requisition_sum=requisition_sum,
        )

        if abs(requisition_sum) > 0.01:
            _progress(
                progress,
                "requisition_mismatch",
                "The remaining requisition amount is not zero.",
                total_price=total_price,
                requisition_sum=requisition_sum,
            )
            base_result.update(
                {
                    "outcome": "failed",
                    "message": (
                        "The DMS remaining requisition amount did not become zero "
                        f"(remaining: {requisition_sum}). The process was stopped before Save."
                    ),
                    "total_price": total_price,
                    "requisition_sum": requisition_sum,
                    "pulled_quantity": quantity,
                }
            )
            return base_result

        if dry_run:
            _progress(
                progress,
                "dry_run_ok",
                "Dry run completed; Save was not clicked.",
                total_price=total_price,
                requisition_sum=requisition_sum,
            )
            base_result.update(
                {
                    "outcome": "dry_run_ok",
                    "message": "Dry run completed successfully. Save was not clicked.",
                    "total_price": total_price,
                    "requisition_sum": requisition_sum,
                    "pulled_quantity": quantity,
                }
            )
            return base_result

        _progress(progress, "saving", "Saving the PreRF request...")
        await page.wait_for_selector("#SaveBtn:not([disabled])", state="visible", timeout=20000)
        await page.click("#SaveBtn")

        _progress(progress, "waiting_success", "Waiting for DMS confirmation...")
        outcome, message = await _wait_for_save_outcome(page, dialogs)

        if outcome == "error":
            raise LiftingPullError(f"DMS rejected the request: {message}")
        if outcome == "unknown":
            # Save may have succeeded without a detectable modal. Re-read the
            # list to avoid reporting a false failure.
            _progress(progress, "fetching_rf", "Checking the PreRF list for the new request...")
            rf_row = await _capture_rf_code(page, rows)
            if rf_row:
                base_result.update(
                    {
                        "outcome": "created",
                        "message": "PreRF request created. Success confirmation was not visible, but the request appears in DMS.",
                        "total_price": total_price,
                        "requisition_sum": requisition_sum,
                        "pulled_quantity": quantity,
                        "rf_code": rf_row.get("rf_code"),
                        "rf_date": rf_row.get("rf_date"),
                        "rf_status": rf_row.get("status"),
                    }
                )
                _progress(progress, "created", "PreRF request created.", rf_code=rf_row.get("rf_code"))
                return base_result
            raise LiftingPullError(message)

        _progress(progress, "fetching_rf", "Reading the new RF code from DMS...")
        rf_row = await _capture_rf_code(page, rows)
        base_result.update(
            {
                "outcome": "created",
                "message": "PreRF request created successfully.",
                "total_price": total_price,
                "requisition_sum": requisition_sum,
                "pulled_quantity": quantity,
                "rf_code": rf_row.get("rf_code"),
                "rf_date": rf_row.get("rf_date"),
                "rf_status": rf_row.get("status"),
            }
        )
        _progress(progress, "created", "PreRF request created successfully.", rf_code=rf_row.get("rf_code"))
        return base_result

    except LiftingPullError as exc:
        logger.warning("PreRF pull blocked/failed for %s: %s", house_name, exc)
        base_result["message"] = str(exc)
        _progress(progress, "failed", str(exc))
        return base_result
    except Exception as exc:
        logger.exception("PreRF pull crashed for %s", house_name)
        base_result["message"] = f"PreRF automation failed: {exc}"
        _progress(progress, "failed", base_result["message"])
        return base_result
    finally:
        if page:
            try:
                await page.close()
            except Exception:
                pass
