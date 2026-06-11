import pandas as pd
from datetime import datetime
from app.models.mela import Mela, MelaAssignment
from app.services.db_service import async_session

async def process_mela_excel(file_path, house_id):
    try:
        # Excel read
        df = pd.read_excel(file_path, dtype=str)
        df.columns = df.columns.str.strip()
        
        total_rows = len(df)
        if total_rows == 0: return 0, "No data found in file."

        async with async_session() as session:
            for _, row in df.iterrows():
                # 1. Fix date format
                raw_date = row.get('Activity Date (MM-DD-YYYY)')
                if not raw_date or str(raw_date).lower() == 'nan': continue
                
                try:
                    # pd.to_datetime is very flexible
                    act_date = pd.to_datetime(raw_date).date()
                except:
                    continue

                # 2. Collect BTS codes
                bts_list = [row.get(f'BTS Code {i}') for i in range(1, 6)]
                bts_list = [str(b).strip() for b in bts_list if b and str(b).strip() not in ["0", "nan", "None"]]
                
                # 3. New mela entry
                new_mela = Mela(
                    house_id=house_id,
                    activity_date=act_date,
                    thana=row.get('Thana'),
                    location=row.get('Event Location Address'),
                    event_type=row.get('Event Type'),
                    activity_type=row.get('Activity Selection ( Only for Zoom IN)'),
                    bts_codes=",".join(bts_list)
                )
                session.add(new_mela)
                await session.flush() # Generate ID

                # 4. Assignment processing (RSO, BP, SSO/Shopkeeper)
                assignments = []
                
                # RSO Codes (1-5)
                for i in range(1, 6):
                    code = row.get(f'RSO Assisted Code {i}')
                    if code and str(code).strip() not in ["0", "nan", "None"]:
                        assignments.append(MelaAssignment(mela_id=new_mela.id, retailer_code=str(code).strip(), role_type='RSO'))
                
                # BP Codes (1-4)
                for i in range(1, 5):
                    code = row.get(f'BP Assisted Code {i}')
                    if code and str(code).strip() not in ["0", "nan", "None"]:
                        assignments.append(MelaAssignment(mela_id=new_mela.id, retailer_code=str(code).strip(), role_type='BP'))
                
                # SSO/Shopkeeper Codes (1-5)
                for i in range(1, 6):
                    code = row.get(f'SSO Code {i}')
                    if code and str(code).strip() not in ["0", "nan", "None"]:
                        assignments.append(MelaAssignment(mela_id=new_mela.id, retailer_code=str(code).strip(), role_type='SHOPKEEPER'))

                if assignments:
                    session.add_all(assignments)
            
            await session.commit()
            return len(df), None
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return 0, str(e)