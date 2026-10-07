import streamlit as st
import data_access

def my_read(month, year):
    query = 'SELECT DISTINCT snapshot_month, snapshot_year FROM workspace.default.employee_schedule_snapshot LIMIT 100'
    res = data_access._client(query)
    st.error(str(res))
    return []

data_access.read_schedule_databricks = my_read
