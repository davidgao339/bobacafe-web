import os
import gspread
from google.oauth2.service_account import Credentials
from config import SS_IDS, TABS

_CREDS_PATH = os.path.join(os.path.dirname(__file__), 'credentials.json')
_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']


def _client():
    if os.path.exists(_CREDS_PATH):
        creds = Credentials.from_service_account_file(_CREDS_PATH, scopes=_SCOPES)
    else:
        import streamlit as st
        info = dict(st.secrets['gcp_service_account'])
        creds = Credentials.from_service_account_info(info, scopes=_SCOPES)
    return gspread.authorize(creds)


def _sheet(ss_id, tab_name):
    ws = _client().open_by_key(ss_id).worksheet(tab_name)
    return ws


def _read(ss_id, tab_name):
    # UNFORMATTED_VALUE returns dates as serial numbers and numbers as floats,
    # which is more reliable than locale-dependent formatted strings.
    return _sheet(ss_id, tab_name).get_all_values(value_render_option='UNFORMATTED_VALUE')


def read_schedule_raw():  return _read(SS_IDS['SCHEDULE'],  TABS['SCHEDULE'])
def read_employees_raw(): return _read(SS_IDS['EMPLOYEES'], TABS['EMPLOYEES'])
def read_salary_raw():    return _read(SS_IDS['MAIN'],      TABS['SALARY'])
def read_bonuses_raw():   return _read(SS_IDS['BONUSES'],   TABS['BONUSES'])
def read_paid_raw():      return _read(SS_IDS['MAIN'],      TABS['PAID'])


def read_schedule_databricks(month, year):
    import urllib.request
    import urllib.parse
    import json
    import base64
    import streamlit as st
    
    if 'databricks' not in st.secrets:
        raise Exception("Databricks secrets not found in secrets.toml. Please configure them.")
        
    dbx = dict(st.secrets['databricks'])
    token = dbx.get('token')
    client_id = dbx.get('client_id')
    client_secret = dbx.get('client_secret')
    warehouse_id = dbx.get('warehouse_id')
    workspace = "https://dbc-d5bd17fc-eaf4.cloud.databricks.com"
    
    if not warehouse_id:
        raise Exception("Databricks warehouse_id missing in secrets.toml")
        
    if not token:
        if not all([client_id, client_secret]):
            raise Exception("Databricks credentials missing. Provide either 'token' (PAT) or both 'client_id' and 'client_secret'.")
        
        # Get OAuth token if PAT is not provided
        basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        body = urllib.parse.urlencode({"grant_type": "client_credentials", "scope": "all-apis"}).encode()
        req = urllib.request.Request(
            f"{workspace}/oidc/v1/token",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Authorization": f"Basic {basic}"},
        )
        with urllib.request.urlopen(req) as resp:
            token = json.loads(resp.read())["access_token"]
        
    # Query Data
    query = f"""
        SELECT date, store, shift, employee, snapshot_half 
        FROM workspace.default.employee_schedule_snapshot 
        WHERE snapshot_month = {month} AND snapshot_year = {year}
    """
    payload = json.dumps({
        "statement": query,
        "warehouse_id": warehouse_id,
        "wait_timeout": "50s",
        "on_wait_timeout": "CANCEL",
    }).encode()
    
    req = urllib.request.Request(
        f"{workspace}/api/2.0/sql/statements",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
        
    if result.get("status", {}).get("state") != "SUCCEEDED":
        raise Exception(f"Databricks SQL error: {result.get('status')}")
        
    cols = [c["name"] for c in result["manifest"]["schema"]["columns"]]
    rows = result.get("result", {}).get("data_array", [])
    return [dict(zip(cols, row)) for row in rows]


def write_payment_sheet(rows):
    ws = _sheet(SS_IDS['MAIN'], TABS['PAYMENT'])
    ws.clear()
    if rows:
        ws.update(values=rows, range_name='A1')
        ws.format('1:1', {'textFormat': {'bold': True}})


def write_verification_sheet(rows):
    ws = _sheet(SS_IDS['MAIN'], TABS['VERIFICATION'])
    ws.clear()
    if rows:
        ws.update(values=rows, range_name='A1')
        ws.format('1:1', {'textFormat': {'bold': True}})
        ws.format(f'{len(rows)}:{len(rows)}', {'textFormat': {'bold': True}})
