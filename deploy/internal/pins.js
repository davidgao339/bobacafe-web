// ── Boba Кролик — password config ────────────────────────────────────────────
// Standardized Role-Based Access:
// • Master (7530):   Admin access to all apps + Password Management (/internal/admin.html)
// • Manager (9876):  Management access to operational apps (Reports, Schedule, Audit, Stores, Tapioca, Bank, Cash)
// • Cook (1234):     Warehouse app — kitchen production access only
// • Employee (1234): Schedule app (view shifts) & Audit app (quick count)
window.BC_PINS = {
  // Primary Roles
  master:        '7530',  // opens any PIN-gated app; Master PIN for /internal/admin.html
  manager:       '9876',  // operational manager PIN (Reports, Schedule, Audit, Stores, etc.)
  cook:          '1234',  // warehouse & production app — cook role (production only)
  employee:      '1234',  // employee role for schedule & quick count

  // App-specific aliases for backward compatibility
  reports:       '9876',  // weekly/monthly reports
  bank:          '9876',  // bank statement Streamlit app
  cash:          '9876',  // cash reconciliation Streamlit app
  boba:          '9876',  // tapioca cooking plan
  schedule:      '1234',  // schedule app employee PIN
  payroll:       '9876',  // payroll app manager password
  inv_admin:     '7530',  // inventory app — admin role
  inv_logistics: '9876',  // inventory app — logistics role
  inv_manager:   '9876',  // inventory app — manager role
  quick_count:   '1234',  // inventory app — quick count (branch baristas)
  warehouse:     '9876',  // warehouse & production app — warehouse manager
};


