import os
import re
import math
import logging
from typing import Optional, List, Dict, Tuple, Any
from dataclasses import dataclass, field
from pathlib import Path
from contextlib import contextmanager

try:
    import xlwings as xw
    HAS_XLWINGS = True
except ImportError:
    HAS_XLWINGS = False


logger = logging.getLogger(__name__)


@dataclass
class SlotInfo:
    type: str
    start: int
    end: int
    count: int
    status_col: int
    rows: List[int]


@dataclass
class StockInfo:
    amount: int
    quantity: int
    value: int


@dataclass
class AllocationReport:
    slots: List[SlotInfo] = field(default_factory=list)
    remaining_amount: int = 0
    fulfilled_amount: int = 0
    current_stock: List[StockInfo] = field(default_factory=list)
    future_stock: List[StockInfo] = field(default_factory=list)


class SCSerialConfig:
    SC_FILE_PATH: str = r"G:\My Drive\BL\RSO\SC Issue (Monthly)\2026\SC Serial List.xlsb"
    MAX_ROWS: int = 800000

    @classmethod
    def from_env(cls) -> "SCSerialConfig":
        cfg = cls()
        cfg.SC_FILE_PATH = os.getenv("SC_FILE_PATH", cfg.SC_FILE_PATH)
        raw_max = os.getenv("SC_MAX_ROWS", str(cfg.MAX_ROWS))
        try:
            cfg.MAX_ROWS = int(raw_max)
        except (ValueError, TypeError):
            pass
        return cfg


class ExcelConnectionError(Exception):
    pass


class SheetNotFoundError(Exception):
    pass


class SCSerialManager:
    def __init__(self, config: Optional[SCSerialConfig] = None):
        if not HAS_XLWINGS:
            raise RuntimeError(
                "xlwings is required. Install it with: pip install xlwings"
            )
        self.config = config or SCSerialConfig.from_env()
        self._bot_opened: bool = False
        self._wb: Optional[xw.Book] = None

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------
    def connect(self) -> xw.Book:
        abs_path = os.path.abspath(self.config.SC_FILE_PATH)
        filename = os.path.basename(abs_path)
        book: Optional[xw.Book] = None
        opened_by_us = False

        book = self._try_find_by_name(filename, abs_path)
        if not book:
            book = self._try_scan_all_apps(abs_path)
        if not book:
            book, opened_by_us = self._try_open_or_create(abs_path)

        if not book:
            raise ExcelConnectionError(
                f"Unable to open or create file: {abs_path}"
            )

        self._wb = book
        self._bot_opened = opened_by_us
        return book

    def close(self) -> None:
        if self._wb and self._bot_opened:
            try:
                self._wb.app.quit()
            except Exception:
                pass
        self._wb = None
        self._bot_opened = False

    @contextmanager
    def connection(self):
        try:
            self.connect()
            yield self._wb
        finally:
            self.close()

    def _try_find_by_name(self, filename: str, abs_path: str) -> Optional[xw.Book]:
        try:
            book = xw.Book(filename)
            if os.path.normpath(book.fullname).lower() == os.path.normpath(abs_path).lower():
                return book
        except Exception:
            pass
        return None

    def _try_scan_all_apps(self, abs_path: str) -> Optional[xw.Book]:
        try:
            for app in xw.apps:
                for book in app.books:
                    if os.path.normpath(book.fullname).lower() == os.path.normpath(abs_path).lower():
                        return book
        except Exception:
            pass
        return None

    def _try_open_or_create(self, abs_path: str) -> Tuple[Optional[xw.Book], bool]:
        try:
            app = xw.App(visible=False)
            if os.path.exists(abs_path):
                book = app.books.open(abs_path)
            else:
                book = app.books.add()
                book.sheets[0].name = "Default"
                book.save(abs_path)
            return book, True
        except Exception as e:
            logger.error("Failed to open/create Excel file: %s", e)
            return None, False

    # ------------------------------------------------------------------
    # Sheet operations
    # ------------------------------------------------------------------
    def get_all_house_sheets(self) -> List[str]:
        with self.connection() as wb:
            return [s.name for s in wb.sheets if s.name != "Default"]

    def house_sheet_exists(self, house_code: str) -> bool:
        with self.connection() as wb:
            return house_code in [s.name for s in wb.sheets]

    def create_house_sheet(self, house_code: str) -> bool:
        with self.connection() as wb:
            sheet_names = [s.name for s in wb.sheets]
            if len(wb.sheets) == 1 and wb.sheets[0].name == "Default":
                wb.sheets[0].name = house_code
                wb.save()
                return True
            if house_code not in sheet_names:
                wb.sheets.add(house_code)
                wb.save()
                return True
            return False

    # ------------------------------------------------------------------
    # Existing amounts / columns
    # ------------------------------------------------------------------
    def get_existing_amounts(self, house_code: str) -> List[str]:
        with self.connection() as wb:
            if house_code not in [s.name for s in wb.sheets]:
                return []
            sheet = wb.sheets[house_code]
            headers = sheet.range("1:1").value
            amounts: List[str] = []
            if not headers:
                return amounts
            for h in headers:
                if h and "tk" in str(h) and "_Status" not in str(h):
                    match = re.search(r'(\d+)', str(h))
                    if match and match.group(1) not in amounts:
                        amounts.append(match.group(1))
            return amounts

    # ------------------------------------------------------------------
    # Add serials
    # ------------------------------------------------------------------
    def add_serials(self, house_code: str, amount: int, serials: List[str]) -> Tuple[bool, str]:
        with self.connection() as wb:
            sheet = wb.sheets[house_code]
            header_name = f"{amount}tk"

            col_idx = 1
            found_col: Optional[int] = None

            while True:
                current_header = sheet.range((1, col_idx)).value

                if not current_header:
                    found_col = col_idx
                    sheet.range((1, col_idx)).value = header_name
                    sheet.range((1, col_idx + 1)).value = f"{header_name}_Status"
                    break

                if str(current_header) == header_name or str(current_header).startswith(f"{header_name}_"):
                    last_row = sheet.range((sheet.cells.last_cell.row, col_idx)).end('up').row
                    if last_row == 1 and not sheet.range((2, col_idx)).value:
                        last_row = 1

                    if len(serials) <= (self.config.MAX_ROWS - last_row):
                        found_col = col_idx
                        break
                    else:
                        col_idx += 2
                        if "_" in header_name:
                            parts = header_name.split("_")
                            header_name = f"{parts[0]}_{int(parts[1]) + 1}"
                        else:
                            header_name = f"{header_name}_1"
                else:
                    col_idx += 2

            if found_col is None:
                return False, "Could not find suitable column"

            self._safe_format_column(sheet, found_col)
            last_row_actual = sheet.range((sheet.cells.last_cell.row, found_col)).end('up').row
            start_row = last_row_actual + 1
            if start_row == 2 and not sheet.range((2, found_col)).value:
                start_row = 2

            data_to_write = [[s] for s in serials]
            sheet.range((start_row, found_col)).value = data_to_write
            wb.save()

            header_value = sheet.range((1, found_col)).value
            return True, str(header_value) if header_value else ""

    @staticmethod
    def _safe_format_column(sheet, col_idx: int) -> None:
        try:
            sheet.range((2, col_idx), (SCSerialConfig.MAX_ROWS + 1, col_idx)).number_format = '0'
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Available slots analysis
    # ------------------------------------------------------------------
    def get_available_slots(
        self,
        house_code: str,
        request_amount: int,
    ) -> AllocationReport:
        report = AllocationReport()

        with self.connection() as wb:
            if house_code not in [s.name for s in wb.sheets]:
                raise SheetNotFoundError(f"House sheet '{house_code}' not found")

            sheet = wb.sheets[house_code]
            headers = sheet.range("1:1").value

            amount_cols = self._parse_amount_columns(headers)
            remaining_money = request_amount

            for col_info in amount_cols:
                amt_val = col_info['amt']
                col_idx = col_info['col']
                status_col_idx = col_idx + 1

                last_row = sheet.range(
                    sheet.cells(sheet.cells.last_cell.row, col_idx).address
                ).end('up').row

                if last_row < 2:
                    report.current_stock.append(StockInfo(amt_val, 0, 0))
                    report.future_stock.append(StockInfo(amt_val, 0, 0))
                    continue

                status_list = sheet.range((2, status_col_idx), (last_row, status_col_idx)).value
                if not isinstance(status_list, list):
                    status_list = [status_list]

                unused_indices = [
                    idx for idx, val in enumerate(status_list)
                    if val is None or str(val).strip() == ""
                ]
                current_qty = len(unused_indices)
                report.current_stock.append(
                    StockInfo(amt_val, current_qty, current_qty * amt_val)
                )

                cards_taken = 0
                if remaining_money > 0:
                    needed = math.ceil(remaining_money / amt_val)
                    take_indices = unused_indices[:needed]
                    cards_taken = len(take_indices)

                    if cards_taken > 0:
                        serials_list = sheet.range((2, col_idx), (last_row, col_idx)).value
                        if not isinstance(serials_list, list):
                            serials_list = [serials_list]

                        self._build_slot_report(
                            serials_list, take_indices, col_info['name'],
                            status_col_idx, report
                        )

                        report.fulfilled_amount += cards_taken * amt_val
                        remaining_money -= cards_taken * amt_val

                remaining_qty = current_qty - cards_taken
                report.future_stock.append(
                    StockInfo(amt_val, remaining_qty, remaining_qty * amt_val)
                )

        report.remaining_amount = max(0, remaining_money)
        return report

    def _build_slot_report(
        self,
        serials_list: List,
        take_indices: List[int],
        col_name: str,
        status_col_idx: int,
        report: AllocationReport,
    ) -> None:
        temp_start = take_indices[0]
        for i in range(1, len(take_indices)):
            curr_idx = take_indices[i]
            prev_idx = take_indices[i - 1]
            if int(serials_list[curr_idx]) != int(serials_list[prev_idx]) + 1:
                report.slots.append(SlotInfo(
                    type=col_name,
                    start=int(serials_list[temp_start]),
                    end=int(serials_list[take_indices[i - 1]]),
                    count=take_indices[i - 1] - temp_start + 1,
                    status_col=status_col_idx,
                    rows=[temp_start + 2, take_indices[i - 1] + 2],
                ))
                temp_start = curr_idx

        report.slots.append(SlotInfo(
            type=col_name,
            start=int(serials_list[temp_start]),
            end=int(serials_list[take_indices[-1]]),
            count=take_indices[-1] - temp_start + 1,
            status_col=status_col_idx,
            rows=[temp_start + 2, take_indices[-1] + 2],
        ))

    # ------------------------------------------------------------------
    # Mark slots as used
    # ------------------------------------------------------------------
    def mark_slots_used(self, house_code: str, slots: List[SlotInfo]) -> bool:
        with self.connection() as wb:
            sheet = wb.sheets[house_code]

            prev_screen = wb.app.screen_updating
            prev_calc = wb.app.calculation
            wb.app.screen_updating = False
            wb.app.calculation = 'manual'

            try:
                for slot in slots:
                    start_row, end_row = slot.rows
                    status_col = slot.status_col
                    used_data = [["Used"]] * (end_row - start_row + 1)
                    sheet.range((start_row, status_col), (end_row, status_col)).value = used_data
                wb.save()
                return True
            except Exception as e:
                logger.error("Failed to mark slots as used: %s", e)
                return False
            finally:
                wb.app.calculation = prev_calc
                wb.app.screen_updating = prev_screen

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _parse_amount_columns(headers: List) -> List[Dict[str, Any]]:
        cols = []
        for i, h in enumerate(headers):
            if h and "tk" in str(h) and "_Status" not in str(h):
                match = re.search(r'(\d+)', str(h))
                if match:
                    cols.append({
                        'amt': int(match.group(1)),
                        'col': i + 1,
                        'name': str(h),
                    })
        cols.sort(key=lambda x: x['amt'])
        return cols
