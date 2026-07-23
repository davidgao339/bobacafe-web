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
