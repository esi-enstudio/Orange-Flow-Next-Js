import pandas as pd
from datetime import date

inputs = ['02-Jun-2026', '15-Apr-2026', '2026-06-02', '', '01-Jan-2025', 'some garbage']
today_str = date.today().strftime('%Y-%m-%d')

for raw_date in inputs:
    if raw_date:
        try:
            parsed_date = pd.to_datetime(raw_date, format='%d-%b-%Y')
        except (ValueError, TypeError, AssertionError):
            try:
                parsed_date = pd.to_datetime(raw_date, format='%Y-%m-%d')
            except (ValueError, TypeError, AssertionError):
                parsed_date = pd.to_datetime(raw_date, errors='coerce')
        activation_date_val = parsed_date.strftime('%Y-%m-%d') if isinstance(parsed_date, pd.Timestamp) and pd.notna(parsed_date) else raw_date
    else:
        activation_date_val = raw_date
    
    match = '✅ MATCHES today' if activation_date_val == today_str else ''
    print(f'  \"{raw_date}\" -> \"{activation_date_val}\" {match}')
