import pandas as pd

inputs = ['02-Jun-2026', '15-Apr-2026', '2026-06-02', '', '01-Jan-2025']

for raw in inputs:
    print(f'--- Input: \"{raw}\" ---')
    
    # Test step 1
    p1 = pd.to_datetime(raw, format='%d-%b-%Y', errors='ignore')
    print(f'  pd.to_datetime(format=\"%d-%b-%Y\", errors=ignore): {type(p1).__name__} = {repr(p1)}')
    
    # Test step 2
    if isinstance(p1, pd.Timestamp):
        print(f'  -> Is Timestamp, OK')
    else:
        p2 = pd.to_datetime(raw, errors='coerce')
        print(f'  pd.to_datetime(errors=coerce): {type(p2).__name__} = {repr(p2)}')
        if pd.notna(p2):
            print(f'  -> Coerced OK')
    
    print()
