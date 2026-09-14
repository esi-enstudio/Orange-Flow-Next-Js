def exclude_clause(model, excluded_codes: set[str]):
    codes = list(excluded_codes)
    if codes:
        return ~model.product_code.in_(codes)
    return None