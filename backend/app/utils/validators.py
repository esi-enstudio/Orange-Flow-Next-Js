import re

def validate_and_expand_serials(text_input: str, max_limit: int = 50):
    """
    Global logic for SIM serial validation and range expansion.
    Returns: (valid_serials, invalid_lines, error_message)
    """
    raw_lines = [line.strip() for line in text_input.strip().split("\n") if line.strip()]
    final_serials = []
    invalid_lines = []
    error_message = None

    for line in raw_lines:
        # 1. Standard 18-digit serial check
        if re.fullmatch(r'\d{18}', line):
            final_serials.append(line)
        
        # 2. Range check (e.g.: 898803991849230687-690)
        elif "-" in line:
            parts = line.split("-")
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                start_full = parts[0]
                end_suffix = parts[1]
                
                # Separate prefix based on suffix length
                suffix_len = len(end_suffix)
                if len(start_full) >= suffix_len:
                    start_suffix = start_full[-suffix_len:]
                    prefix = start_full[:-suffix_len]

                    try:
                        start_num = int(start_suffix)
                        end_num = int(end_suffix)

                        if start_num <= end_num:
                            # Range expand
                            for i in range(start_num, end_num + 1):
                                new_suffix = str(i).zfill(suffix_len)
                                final_serials.append(prefix + new_suffix)
                        else:
                            invalid_lines.append(line)
                    except:
                        invalid_lines.append(line)
                else:
                    invalid_lines.append(line)
            else:
                invalid_lines.append(line)
        else:
            invalid_lines.append(line)

    # 3. Remove duplicates
    final_serials = list(dict.fromkeys(final_serials))

    # 4. Limit check and error message creation
    if invalid_lines:
        error_message = "⚠️ **Invalid format detected!**\n\n"
        for err in invalid_lines:
            error_message += f"❌ `{err}`\n"
        error_message += "\n**Correct example:**\n`898803991849230680` (single)\n`898803991849230687-690` (range)"
    
    elif len(final_serials) > max_limit:
        error_message = f"⚠️ You have provided {len(final_serials)} SIMs at once. Please provide a maximum of {max_limit} SIMs at a time."
    
    elif not final_serials:
        error_message = "⚠️ No valid SIM serial found."

    return final_serials, invalid_lines, error_message