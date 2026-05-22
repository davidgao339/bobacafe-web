import os
import gspread
from google.oauth2.service_account import Credentials
from config import SPREADSHEET_ID

_CREDS_PATH = os.path.join(os.path.dirname(__file__), 'credentials.json')
_SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly',
]


def _client():
    if os.path.exists(_CREDS_PATH):
        creds = Credentials.from_service_account_file(_CREDS_PATH, scopes=_SCOPES)
    else:
        import streamlit as st
        info = {k: v for k, v in st.secrets['gcp_service_account'].items()}
        creds = Credentials.from_service_account_info(info, scopes=_SCOPES)
    return gspread.authorize(creds)


def read_responses() -> list[dict]:
    """Read all rows from the form responses sheet (sheet1)."""
    ws = _client().open_by_key(SPREADSHEET_ID).sheet1
    return ws.get_all_records()


def write_schedule(gid: int, header_row: list, data_rows: list):
    """Write schedule to the sheet identified by gid."""
    gc = _client()
    ss = gc.open_by_key(SPREADSHEET_ID)
    ws = ss.get_worksheet_by_id(gid)
    ws.clear()
    ws.update([header_row] + data_rows)
    ws.format('1:1', {'textFormat': {'bold': True}})
