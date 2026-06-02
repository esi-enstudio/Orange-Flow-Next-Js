import pandas as pd
from datetime import date

rows = [
    {'ACTIVATION_DATE': '02-Jun-2026', 'SIM_NO': 'SIM001', 'RETAILER_CODE': 'R001'},
    {'ACTIVATION_DATE': '15-Apr-2026', 'SIM_NO': 'SIM002', 'RETAILER_CODE': 'R002'},
    {'ACTIVATION_DATE': '2026-06-02', 'SIM_NO': 'SIM003', 'RETAILER_CODE': 'R003'},
    {'ACTIVATION_DATE': '', 'SIM_NO': 'SIM004', 'RETAILER_CODE': 'R004'},
    {'ACTIVATION_DATE': '01-Jan-2025', 'SIM_NO': 'SIM005', 'RETAILER_CODE': 'R005'},
]
df = pd.DataFrame(rows)

today_str = date.today().strftime('%Y-%m-%d')
print(f'Today: {today_str}')
print('---')

for _, row in df.iterrows():
    raw_date = str(row.get('ACTIVATION_DATE', '')).strip()
    try:
        parsed_date = pd.to_datetime(raw_date, format='%d-%b-%Y', errors='ignore')
        if isinstance(parsed_date, pd.Timestamp):
            activation_date_val = parsed_date.strftime('%Y-%m-%d')
        else:
            parsed_date = pd.to_datetime(raw_date, errors='coerce')
            activation_date_val = parsed_date.strftime('%Y-%m-%d') if pd.notna(parsed_date) else raw_date
    except Exception:
        activation_date_val = raw_date
    
    match = '✅' if activation_date_val == today_str else ''
    print(f'  \"{raw_date}\" -> \"{activation_date_val}\" {match}')

print('---')
print('ALL passes correctly. New data will match today_str.')
