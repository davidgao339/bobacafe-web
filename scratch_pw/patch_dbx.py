import streamlit as st
import data_access

def my_read(month, year):
    query = 'SELECT DISTINCT snapshot_month, snapshot_year FROM workspace.default.employee_schedule_snapshot'
    
    import urllib.request
    import urllib.parse
    import json
    import base64
    
    dbx = dict(st.secrets['databricks'])
    token = dbx.get('token')
    client_id = dbx.get('client_id')
    client_secret = dbx.get('client_secret')
    warehouse_id = dbx.get('warehouse_id')
    workspace = "https://dbc-d5bd17fc-eaf4.cloud.databricks.com"
    
    if not token:
        basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        body = urllib.parse.urlencode({"grant_type": "client_credentials", "scope": "all-apis"}).encode()
        req = urllib.request.Request(
            f"{workspace}/oidc/v1/token",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Authorization": f"Basic {basic}"},
        )
        with urllib.request.urlopen(req) as resp:
            token = json.loads(resp.read())["access_token"]
            
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
    import time
    while result.get("status", {}).get("state") in ["PENDING", "RUNNING"]:
        time.sleep(2)
        poll_req = urllib.request.Request(
            f"{workspace}/api/2.0/sql/statements/{statement_id}",
            headers={"Authorization": f"Bearer {token}"},
            method="GET",
        )
        with urllib.request.urlopen(poll_req) as resp:
            result = json.loads(resp.read())
            
    st.error(f"DATABRICKS UNIQUE DATES: {result.get('result', {}).get('data_array')}")
    
    # Return empty so the app doesn't crash downstream
    return []

data_access.read_schedule_databricks = my_read
