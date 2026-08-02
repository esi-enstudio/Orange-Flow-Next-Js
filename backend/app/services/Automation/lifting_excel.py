import pandas as pd
import logging
from io import BytesIO

logger = logging.getLogger(__name__)

LIFTING_EXPORT_COLUMNS = [
    "RECORD_ID", "LIFTING_DATE", "HOUSE", "PAYMENT_METHOD", "STATUS",
    "BANK_DEPOSIT", "TOTAL_LIFTING", "ITOPUP", "REMAINING", "NOTES",
    "PRODUCT_CODE", "PRODUCT_NAME", "QUANTITY", "UNIT_PRICE", "TOTAL_PRICE",
]


async def export_lifting_records_excel(records):
    data = []
    for r in records:
        house_name = (r.house.display_name or r.house.name) if r.house else f"House #{r.house_id}"
        line_items = r.products or [None]
        for p in line_items:
            data.append({
                "RECORD_ID": r.id,
                "LIFTING_DATE": r.lifting_date.isoformat() if hasattr(r.lifting_date, "isoformat") else str(r.lifting_date),
                "HOUSE": house_name,
                "PAYMENT_METHOD": getattr(r.payment_method, "value", r.payment_method),
                "STATUS": getattr(r.status, "value", r.status),
                "BANK_DEPOSIT": r.total_bank_deposit,
                "TOTAL_LIFTING": r.total_lifting_amount,
                "ITOPUP": r.itopup_amount,
                "REMAINING": r.remaining_amount,
                "NOTES": r.notes or "",
                "PRODUCT_CODE": p.product_code if p else "",
                "PRODUCT_NAME": p.product_name if p else "",
                "QUANTITY": p.quantity if p else "",
                "UNIT_PRICE": p.unit_price if p else "",
                "TOTAL_PRICE": p.total_price if p else "",
            })
    df = pd.DataFrame(data, columns=LIFTING_EXPORT_COLUMNS)
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Lifting Records")
    buf.seek(0)
    return buf.getvalue()
