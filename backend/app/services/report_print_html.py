"""Print-ready HTML for a report's WhatsApp image pages.

The report pages print with the same layout the WhatsApp delivery sends: the
report is rendered by its image builder (one PNG per A4 page) and that image is
what goes onto paper, one page image per sheet. This module turns those PNGs
into a tiny self-contained HTML document — images inlined as data URIs, an
``@page`` rule matching the image orientation and a ``window.print()`` on load —
so the frontend only has to open the returned document.
"""
import base64
import html
import io

from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

# Report images are deliberately large (multi-thousand pixel) renders - the size
# is intended, not a decompression bomb.
Image.MAX_IMAGE_PIXELS = None

from app.services.report_builders import get_report_title
from app.services.whatsapp_schedule_service import get_report_image


def _png_size(png: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(png)) as img:
        return img.size


def _page_markup(png: bytes, title: str, page_no: int) -> str:
    encoded = base64.b64encode(png).decode("ascii")
    alt = f"{html.escape(title)} — page {page_no}"
    return f'<img class="page" src="data:image/png;base64,{encoded}" alt="{alt}">'


async def render_report_print_html(
    db: AsyncSession,
    report_type: str,
    house_id: int,
    *,
    period: dict | None = None,
) -> str:
    """Render ``report_type`` for ``house_id`` as a print-ready HTML document.

    ``period`` is the report page's own period (``{start_date, end_date}`` or
    ``{month, year}``); without it the current month is rendered. The document
    prints one report-image page per A4 sheet and starts the browser's print
    dialog as soon as its images are ready.
    """
    image = await get_report_image(db, report_type, house_id, period=period)
    pages = image if isinstance(image, list) else [image]
    if not pages:
        raise ValueError("The report produced no pages to print")

    title = get_report_title(report_type)
    width, height = _png_size(pages[0])
    orientation = "landscape" if width >= height else "portrait"
    imgs = "\n".join(_page_markup(png, title, i) for i, png in enumerate(pages, 1))

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{html.escape(title)}</title>
<style>
  @page {{ size: A4 {orientation}; margin: 0; }}
  html, body {{ margin: 0; padding: 0; background: #ffffff; }}
  img.page {{ display: block; width: 100%; height: auto; }}
  img.page + img.page {{ break-before: page; page-break-before: always; }}
  @media print {{
    body {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  }}
</style>
</head>
<body>
{imgs}
<script>
  // Inline data URIs are decoded before "load" fires, so the print dialog never
  // opens on a half-rendered page.
  window.addEventListener("load", function () {{
    setTimeout(function () {{ window.print(); }}, 150);
  }});
</script>
</body>
</html>
"""
