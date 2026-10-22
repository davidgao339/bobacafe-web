# TODO List

- [x] Dev Inventory Ozon, customized matching of ingredient quantity is not remembered. When I upload PDF again same product doesn't remember inventory impact
- [x] Bug: Payroll ModuleNotFoundError: This app has encountered an error. The original error message is redacted to prevent data leaks. Full error details have been recorded in the logs (if you're on Streamlit Cloud, click on 'Manage app' in the lower right of your app).
Traceback:
File "/mount/src/bobacafe-web/apps/payment/streamlit_app.py", line 6, in <module>
    import sys; sys.path.insert(0, 'scratch_pw'); import patch_dbx
                                                  ^^^^^^^^^^^^^^^^

- [x] Recipe update for prod is not saved. Maybe the update doesn't push to D1. This is for inventory app
- [x] Bug: Custom items in PO are not saved & printed as PDF again
- [x] Bug: Ozon tool doesn't work on warehouse app for warehouse exclusive products
- [x] Bug: Shift optimization is fetching shift availability data from Nov 2025 instead of Nov 2026 because the data from Google sheet doesn't have year

