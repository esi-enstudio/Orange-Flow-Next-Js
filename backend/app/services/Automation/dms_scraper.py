import asyncio
import re
from bs4 import BeautifulSoup
from playwright.async_api import Page

DMS_BASE_URL = "https://blkdms.banglalink.net"
RECEIVE_SIM_FROM_RETAILER_URL = f"{DMS_BASE_URL}/ReceiveSimFrRetailerSubmitView"

MAX_TABLE_PAGES = 50

def _normalize_receive_status(raw: str) -> str:
    """Normalize a status cell to DMS codes: S (Pending), A (Approved), R (Rejected)."""
    text = (raw or "").strip()
    if text.upper() in ("S", "A", "R"):
        return text.upper()
    lowered = text.lower()
    if "reject" in lowered:
        return "R"
    if "approv" in lowered:
        return "A"
    if "pend" in lowered:
        return "S"
    return text[:1].upper()

async def get_receive_sim_from_retailer_list(page: Page, status_filter: str):
    """
    Scrapes the "Receive SIM From Retailer" list (ReceiveSimFrRetailerSubmitView).
    Applies the ddlStatus filter (S=Pending, A=Approved, R=Rejected) via the page's
    own search form, then walks the DataTables pagination.
    Returns: (data_list, error_message)
    """
    rows = []
    seen = set()

    try:
        await page.goto(RECEIVE_SIM_FROM_RETAILER_URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_selector("#ddlStatus", state="attached", timeout=30000)

        current_status = (await page.input_value("#ddlStatus") or "").strip()
        if current_status != status_filter:
            await page.select_option("#ddlStatus", status_filter)

        search_btn = page.locator('button[type="submit"]').filter(has_text=re.compile(r"search", re.I)).first
        if await search_btn.count() == 0:
            search_btn = page.locator("form button[type='submit']").first
        if await search_btn.count() == 0:
            return None, "⚠️ DMS: search button not found on Receive SIM page."

        await search_btn.click()
        await page.wait_for_load_state("domcontentloaded", timeout=60000)

        try:
            await page.wait_for_selector("#DMSdatatable tbody", state="attached", timeout=30000)
        except Exception:
            return None, "⚠️ DMS response timeout or no data found."

        for _ in range(MAX_TABLE_PAGES):
            soup = BeautifulSoup(await page.content(), "html.parser")
            table = soup.find("table", id="DMSdatatable")
            tbody = table.find("tbody") if table else None
            added = 0

            for tr in (tbody.find_all("tr") if tbody else []):
                cols = tr.find_all("td")
                if len(cols) < 8:
                    continue
                texts = [c.get_text(" ", strip=True) for c in cols]
                if not texts[0] or "no data" in texts[0].lower():
                    continue

                link = cols[7].find("a", href=True)
                path = (link.get("href") or "").strip() if link else ""
                if path.startswith("/"):
                    details_url = f"{DMS_BASE_URL}{path}"
                elif path.startswith("http"):
                    details_url = path
                else:
                    details_url = None

                key = (texts[1], texts[2], texts[3], texts[6], details_url or "")
                if key in seen:
                    continue
                seen.add(key)
                added += 1

                qty_match = re.sub(r"[^\d]", "", texts[3])
                rows.append({
                    "distributor_name": texts[0],
                    "retailer_name": texts[1],
                    "receive_date": texts[2],
                    "sim_qty": int(qty_match) if qty_match else 0,
                    "status": _normalize_receive_status(texts[4]),
                    "remarks": texts[5],
                    "create_by": texts[6],
                    "details_url": details_url,
                })

            next_btn = await page.query_selector("#DMSdatatable_next")
            if not next_btn:
                break
            btn_class = await next_btn.get_attribute("class") or ""
            if "disabled" in btn_class:
                break
            if added == 0:
                break
            await next_btn.click()
            await asyncio.sleep(1.5)

        return rows, None

    except Exception as e:
        return None, f"❌ Scraping error: {str(e)}"

async def get_smart_search_results(page: Page):
    """
    Scrapes results from DMS smart search report.
    Handles Error, Card View & Table View (with Pagination).
    Returns: (data_list, error_message)
    """
    results = []
    scanned_sims = set()

    try:
        # 1. Wait for card, table, or error element
        try:
            await page.wait_for_selector(".card-body, #dataTable_Smart_Search_Report, #errorMessage", timeout=20000)
        except:
            return None, "⚠️ DMS response timeout or no data found."

        # 2. Check for error message (Data not found)
        error_element = await page.query_selector("#errorMessage")
        if error_element:
            error_text = (await error_element.inner_text()).strip()
            if "Data not found" in error_text:
                return None, "⚠️ DMS: **No data found.**"
            
            # If positive confirmation (Found/Success), don't treat as error
            elif "Sim Details Information Found By Sim Serial" in error_text or "successfully" in error_text.lower():
                # This is not an error, continue processing
                pass

            # Show any other unknown errors
            elif error_text:
                return None, f"❌ DMS error: {error_text}"

        # 3. If no error, start scraping loop
        while True:
            soup = BeautifulSoup(await page.content(), 'html.parser')

            # --- Case 1: Single card view (Single Result) ---
            single_card = soup.find("h3", string=lambda x: x and "Sim Information" in x)
            if single_card:
                data = {}
                card_div = single_card.find_parent("div", class_="card-body")
                if card_div:
                    table = card_div.find("table")
                    if table:
                        for tr in table.find_all("tr"):
                            ths, tds = tr.find_all("th"), tr.find_all("td")
                            for i in range(len(ths)):
                                key = ths[i].get_text(strip=True).replace(":", "")
                                data[key] = tds[i].get_text(strip=True)
                        
                        sim = data.get("SIM No", "").strip()
                        if sim and sim not in scanned_sims:
                            scanned_sims.add(sim)
                            # MSISDN formatting
                            data['MSISDN'] = data.get("MSISDN", data.get("Mobile No", "N/A"))
                            results.append(data)
                break # Card view has no pagination

            # --- Case 2: Table view (Multiple Results) ---
            multi_table = soup.find("table", id="dataTable_Smart_Search_Report")
            if multi_table:
                rows = multi_table.find("tbody").find_all("tr")
                for row in rows:
                    cols = row.find_all("td")
                    if len(cols) < 10 or "No data" in cols[0].text: continue
                    
                    sim = cols[0].text.strip().replace("'", "")
                    if sim not in scanned_sims:
                        scanned_sims.add(sim)
                        results.append({
                            "SIM No": sim,
                            "Distributor": cols[1].text.strip(),
                            "Retailer": cols[2].text.strip(),
                            "Activation Date": cols[8].text.strip(),
                            "MSISDN": cols[9].text.strip()
                        })

            # --- 4. Pagination (Next Button) handling ---
            next_btn = await page.query_selector("#dataTable_Smart_Search_Report_next")
            if next_btn:
                btn_class = await next_btn.get_attribute("class") or ""
                if "disabled" not in btn_class:
                    await next_btn.click()
                    await asyncio.sleep(2) # Short delay for data render
                    continue # Scrape next page
            
            break # Exit loop if no more pages

        return results, None

    except Exception as e:
        return None, f"❌ Scraping error: {str(e)}"