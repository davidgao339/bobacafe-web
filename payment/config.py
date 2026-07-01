SS_IDS = {
    'SCHEDULE':  '1eAUsX8X5vUYiFUU3Y5sPYFymHMIIKCpwvFkbNFgIBMk',
    'EMPLOYEES': '13NzqIfIIvAqeUcq9AeUGGap_OOWZVt23ViC9vvJaQvQ',
    'MAIN':      '1B67ub1WIsF7_otFiUvB5qG_I_Px2jdcdwvPdNOFQz4k',
    'BONUSES':   '1FVzBV3JL1BfIxT179x_sHMt58Vyy-oZrS6YWsyouv70',
}

TABS = {
    'SCHEDULE':     'source_for_app',
    'EMPLOYEES':    'Employee',
    'SALARY':       'Role Salary Dictionary',
    'BONUSES':      'CHANGE C TO TEXT',
    'PAID':         '2026',
    'PAYMENT':      'Test_Payment',
    'VERIFICATION': 'Test_Verification',
}

def _sheet_url(ss_key, gid):
    return f"https://docs.google.com/spreadsheets/d/{SS_IDS[ss_key]}/edit#gid={gid}"


# Direct links to the tabs the app reads/writes, for the "Data Sources" sidebar section.
# gids are fixed per-tab in Google Sheets, so these are hardcoded rather than looked up live.
SHEET_LINKS = {
    'Schedule':            _sheet_url('SCHEDULE',  1943990106),
    'Employees':           _sheet_url('EMPLOYEES', 0),
    'Salary rates':        _sheet_url('MAIN',       1345297691),
    'Paid records':        _sheet_url('MAIN',       134903595),
    'Bonuses / Penalties': _sheet_url('BONUSES',    1459334593),
    'Payment output':      _sheet_url('MAIN',       536192488),
    'Verification output': _sheet_url('MAIN',       425580909),
}

SKIP_VALUES = {'—', '-', 'вых', 'off', 'точка не работает'}

ALLOWED_EMAILS = [
    'davidgao734@gmail.com',
    'stefa.miva@gmail.com',
]
