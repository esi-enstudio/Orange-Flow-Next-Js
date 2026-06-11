import asyncio
from bs4 import BeautifulSoup
from playwright.async_api import Page

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