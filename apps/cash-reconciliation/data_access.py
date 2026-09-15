import os
import gspread
import pandas as pd
from google.oauth2.service_account import Credentials
import urllib.request
import urllib.parse
import json
import base64
import streamlit as st
import time

_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
SHEET_ID = '1UnD3gRyCWpsAAhnsJwjHInDUErx92Ntd2waMhrOh344'

def _client():
    if 'gcp_service_account' in st.secrets:
        info = dict(st.secrets['gcp_service_account'])
        creds = Credentials.from_service_account_info(info, scopes=_SCOPES)
        return gspread.authorize(creds)
    # local fallback if needed
    _CREDS_PATH = os.path.join(os.path.dirname(__file__), '..', 'payment', 'credentials.json')
    if os.path.exists(_CREDS_PATH):
        creds = Credentials.from_service_account_file(_CREDS_PATH, scopes=_SCOPES)
        return gspread.authorize(creds)
    raise Exception("Google credentials not found in secrets or local JSON.")

@st.cache_data(ttl=600, show_spinner=False)
def get_envelope_cash():
    print("Connecting to Google Sheets...")
    client = _client()
    sh = client.open_by_key(SHEET_ID)
    
    worksheet = None
    for ws in sh.worksheets():
        if ws.id == 809335363:
            worksheet = ws
            break
            
    if not worksheet:
        worksheet = sh.get_worksheet(0)
        
    data = worksheet.get_all_values(value_render_option='UNFORMATTED_VALUE')
    if not data:
        return pd.DataFrame()
    headers = data[0]
    rows = data[1:]
    return pd.DataFrame(rows, columns=headers)

@st.cache_data(ttl=600, show_spinner=False)
def get_sbis_revenue(start_date, end_date):
    if 'databricks' not in st.secrets:
        raise Exception("Databricks secrets not found in secrets.toml.")
        
    dbx = dict(st.secrets['databricks'])
    token = dbx.get('token')
    client_id = dbx.get('client_id')
    client_secret = dbx.get('client_secret')
    warehouse_id = dbx.get('warehouse_id')
    
    workspace = "https://dbc-d5bd17fc-eaf4.cloud.databricks.com"
    
    if not warehouse_id:
        warehouse_id = "959d56e804ae9b36"
        
    if not token:
        if not all([client_id, client_secret]):
            raise Exception("Databricks credentials missing.")
        
        basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        body = urllib.parse.urlencode({"grant_type": "client_credentials", "scope": "all-apis"}).encode()
        req = urllib.request.Request(
            f"{workspace}/oidc/v1/token",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Authorization": f"Basic {basic}"},
        )
        with urllib.request.urlopen(req) as resp:
            token = json.loads(resp.read())["access_token"]
            
    # Update table name to the one provided by the user
    table_name = "workspace.default.daily_sales_v2"
    
    query = f"""
        SELECT date, store, revenue 
        FROM {table_name} 
        WHERE date >= '{start_date}' AND date <= '{end_date}'
          AND payment_type = 'cash'
    """
    
    payload = json.dumps({
        "statement": query,
        "warehouse_id": warehouse_id,
        "wait_timeout": "50s",
        "on_wait_timeout": "CONTINUE",
    }).encode()
    
    req = urllib.request.Request(
        f"{workspace}/api/2.0/sql/statements",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
        
    statement_id = result.get("statement_id")
    print(f"Databricks query submitted. Statement ID: {statement_id}. Initial state: {result.get('status', {}).get('state')}")
    while result.get("status", {}).get("state") in ["PENDING", "RUNNING"]:
        print(f"Databricks query state is {result.get('status', {}).get('state')}... waiting 2 seconds.")
        time.sleep(2)
        poll_req = urllib.request.Request(
            f"{workspace}/api/2.0/sql/statements/{statement_id}",
            headers={"Authorization": f"Bearer {token}"},
            method="GET",
        )
        with urllib.request.urlopen(poll_req) as resp:
            result = json.loads(resp.read())
            
    if result.get("status", {}).get("state") != "SUCCEEDED":
        raise Exception(f"Databricks SQL error: {result.get('status')}")
        
    cols = [c["name"] for c in result["manifest"]["schema"]["columns"]]
    rows = result.get("result", {}).get("data_array", [])
    
    df = pd.DataFrame([dict(zip(cols, row)) for row in rows])
    return df
