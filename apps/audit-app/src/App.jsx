import { useState, useEffect, useMemo, useRef } from 'react';
import { useLanguage } from './context/LanguageContext';
import { 
  fetchStores, 
  fetchIngredients, 
  fetchLatestStoreAudit, 
  fetchAuditForStoreAndDate,
  saveAudit, 
  fetchAuditHistory, 
  fetchAuditDetails, 
  updateAuditStatus, 
  deleteAudit 
} from './services/d1';

const PIN_BARISTA = '1234';
const PIN_MANAGER = '7530';

const CATEGORY_MAP = {
  'СИРОПЫ, ТОППИНГИ, ПЮРЕ': { ru: 'Сиропы и топпинги', en: 'Syrups & Toppings', icon: '🍓' },
  'ПРОИЗВОДСТВО':           { ru: 'Выпечка и кухня',   en: 'Kitchen & Bakery',  icon: '🥐' },
  'ПОРОШКИ':                { ru: 'Порошки и смеси',   en: 'Powders & Mixes',   icon: '🥄' },
  'КОНТЕЙНЕРЫ':             { ru: 'Упаковка и стаканы',en: 'Packaging & Cups',  icon: '🥤' },
  'КУПЕР':                  { ru: 'Молоко и молочка',  en: 'Milk & Dairy',      icon: '🥛' },
  'КИДАНОВА О.В':           { ru: 'Продукты',          en: 'Fresh Products',    icon: '📦' },
  'КОФЕ И ЧАЙ':             { ru: 'Кофе и чай',        en: 'Coffee & Tea',      icon: '🍵' },
  'СКЛАД':                  { ru: 'Складские запасы',  en: 'Warehouse Items',   icon: '🏷️' },
  'ХОЗ. ТОВАРЫ':            { ru: 'Хозтовары',         en: 'Supplies',          icon: '🧹' },
};

function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '—';
  return Number(num).toLocaleString('ru-RU');
}

export default function App() {
  const { t, lang, toggleLang } = useLanguage();

  // Role: null (logged out), 'quick_count' (barista), 'manager' (manager)
  const [role, setRole] = useState(() => {
    // 1. Check URL parameters
    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role');
    if (urlRole === 'quick_count' || urlRole === 'manager') return urlRole;

    // 2. Check session / local storage
    try {
      const stored = localStorage.getItem('audit_role_info');
      if (stored) {
        const { role: r, expires } = JSON.parse(stored);
        if (expires > Date.now()) return r;
        localStorage.removeItem('audit_role_info');
      }
    } catch {}
    return sessionStorage.getItem('audit_role') || null;
  });

  const [activeTab, setActiveTab] = useState('count'); // 'count' | 'history'

  // Global Data
  const [stores, setStores] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Selected Store & Date
  const [selectedStoreId, setSelectedStoreId] = useState(null);
  const [auditDate, setAuditDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Current Counts & Baseline
  const [counts, setCounts] = useState({});
  const [editingAuditId, setEditingAuditId] = useState(null);
  const [existingDateAudit, setExistingDateAudit] = useState(null);
  const [lastAuditBaseline, setLastAuditBaseline] = useState({ lastDate: null, counts: {} });
  const [loadingBaseline, setLoadingBaseline] = useState(false);

  // UI State
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // History State
  const [historyList, setHistoryList] = useState([]);
  const [historyFilterStore, setHistoryFilterStore] = useState('all');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedAuditId, setExpandedAuditId] = useState(null);
  const [auditDetailsMap, setAuditDetailsMap] = useState({});

  // ─── LOGIN HANDLER ──────────────────────────────────────────────────────────

  const handleLogin = (enteredPin) => {
    const p = enteredPin.trim();
    if (p === PIN_BARISTA) {
      setRole('quick_count');
      sessionStorage.setItem('audit_role', 'quick_count');
      return true;
    }
    if (p === PIN_MANAGER || (window.BC_PINS && (p === window.BC_PINS.master || p === window.BC_PINS.inv_admin))) {
      setRole('manager');
      // Store 30 days for managers
      const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
      localStorage.setItem('audit_role_info', JSON.stringify({ role: 'manager', expires }));
      sessionStorage.setItem('audit_role', 'manager');
      return true;
    }
    return false;
  };

  const handleLogout = () => {
    setRole(null);
    localStorage.removeItem('audit_role_info');
    sessionStorage.removeItem('audit_role');
  };

  // ─── LOAD INITIAL STORES & INGREDIENTS ─────────────────────────────────────

  useEffect(() => {
    async function loadData() {
      try {
        const [storesData, ingData] = await Promise.all([fetchStores(), fetchIngredients()]);
        setStores(storesData);
        setIngredients(ingData);
        if (storesData.length > 0 && !selectedStoreId) {
          setSelectedStoreId(storesData[0].store_id);
        }
      } catch (err) {
        showToast('Error loading database: ' + err.message, 'error');
      } finally {
        setLoadingInitial(false);
      }
    }
    loadData();
  }, []);

  // ─── LOAD STORE BASELINE, EXISTING AUDITS & DRAFTS ──────────────────────────

  useEffect(() => {
    if (!selectedStoreId) return;

    let active = true;
    setLoadingBaseline(true);

    // Baseline prior audit and existing audit lookup are strictly for Manager review/verification (Blind Count for Baristas)
    if (role === 'manager') {
      setLoadingBaseline(true);
      fetchLatestStoreAudit(selectedStoreId)
        .then(baseline => {
          if (!active) return;
          setLastAuditBaseline(baseline);
        })
        .catch(console.error)
        .finally(() => {
          if (active) setLoadingBaseline(false);
        });

      // Check if an audit already exists in D1 for this store and date (Manager update mode)
      fetchAuditForStoreAndDate(selectedStoreId, auditDate)
        .then(found => {
          if (!active) return;
          if (found) {
            setExistingDateAudit(found);
            // If no custom local draft and not actively editing another audit, auto-load existing audit for update
            const draftKey = `audit_draft_${selectedStoreId}_${auditDate}`;
            const savedDraft = localStorage.getItem(draftKey);
            if (!savedDraft && !editingAuditId) {
              setCounts(found.counts);
              setEditingAuditId(found.header.audit_id);
            }
          } else {
            setExistingDateAudit(null);
            if (editingAuditId && !editingAuditId.startsWith('A-')) {
              setEditingAuditId(null);
            }
          }
        })
        .catch(console.error);
    } else {
      setLastAuditBaseline({ lastDate: null, counts: {} });
      setExistingDateAudit(null);
    }

    // Check draft in localStorage only if not editing a historical audit
    if (!editingAuditId) {
      const draftKey = `audit_draft_${selectedStoreId}_${auditDate}`;
      try {
        const savedDraft = localStorage.getItem(draftKey);
        if (savedDraft) {
          const parsed = JSON.parse(savedDraft);
          setCounts(parsed);
          showToast(t('draftRestored'), 'info');
        } else if (!existingDateAudit) {
          setCounts({});
        }
      } catch {
        setCounts({});
      }
    }

    return () => { active = false; };
  }, [selectedStoreId, auditDate, role]);

  // ─── COUNT INPUT HANDLERS ──────────────────────────────────────────────────

  const handleCountChange = (ingId, val) => {
    setCounts(prev => {
      const next = { ...prev, [ingId]: val };
      // Auto-save draft
      if (selectedStoreId) {
        localStorage.setItem(`audit_draft_${selectedStoreId}_${auditDate}`, JSON.stringify(next));
      }
      return next;
    });
  };

  const handleClearDraft = () => {
    if (confirm(t('confirmDelete'))) {
      setCounts({});
      if (selectedStoreId) {
        localStorage.removeItem(`audit_draft_${selectedStoreId}_${auditDate}`);
      }
    }
  };

  // ─── SUBMIT AUDIT ──────────────────────────────────────────────────────────

  const handleSubmitAudit = async () => {
    const selectedStore = stores.find(s => s.store_id === selectedStoreId);
    if (!selectedStore) return;

    const filled = ingredients.filter(i => counts[i.ingredient_id] !== undefined && counts[i.ingredient_id] !== '');
    if (filled.length < ingredients.length) {
      if (!confirm(t('incompleteWarning'))) return;
    }

    setSaving(true);
    try {
      await saveAudit({
        auditId: editingAuditId || undefined,
        storeId: selectedStore.store_id,
        storeCode: selectedStore.store_code,
        storeName: selectedStore.store_name,
        auditDate,
        counts,
        status: 'approved'
      });

      if (editingAuditId) {
        setEditingAuditId(null);
      } else {
        localStorage.removeItem(`audit_draft_${selectedStoreId}_${auditDate}`);
      }
      showToast(t('saveSuccess'), 'success');
      
      // Reload baseline
      const newBaseline = await fetchLatestStoreAudit(selectedStoreId);
      setLastAuditBaseline(newBaseline);

      if (role === 'manager') {
        loadHistory();
      }
    } catch (err) {
      showToast('Error saving audit: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleStartEdit = async (audit) => {
    try {
      setSaving(true);
      const details = await fetchAuditDetails(audit.audit_id);
      const loadedCounts = {};
      for (const d of details) {
        loadedCounts[d.ingredient_id] = d.count_quantity;
      }
      setEditingAuditId(audit.audit_id);
      setSelectedStoreId(audit.store_id);
      setAuditDate(audit.audit_date);
      setCounts(loadedCounts);
      setActiveTab('count');
      showToast(`${t('editingNotice')}: ${audit.audit_id}`, 'info');
    } catch (err) {
      showToast('Error loading audit for edit: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingAuditId(null);
    setCounts({});
  };

  // ─── HISTORY HANDLERS (MANAGER) ───────────────────────────────────────────

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const sId = historyFilterStore === 'all' ? null : parseInt(historyFilterStore, 10);
      const rows = await fetchAuditHistory(sId, 100);
      setHistoryList(rows);
    } catch (err) {
      showToast('Error loading history: ' + err.message, 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (role === 'manager' && activeTab === 'history') {
      loadHistory();
    }
  }, [role, activeTab, historyFilterStore]);

  const toggleExpandAudit = async (auditId) => {
    if (expandedAuditId === auditId) {
      setExpandedAuditId(null);
      return;
    }
    setExpandedAuditId(auditId);
    if (!auditDetailsMap[auditId]) {
      try {
        const details = await fetchAuditDetails(auditId);
        setAuditDetailsMap(prev => ({ ...prev, [auditId]: details }));
      } catch (err) {
        showToast('Error loading audit details: ' + err.message, 'error');
      }
    }
  };

  const handleStatusChange = async (auditId, newStatus) => {
    try {
      await updateAuditStatus(auditId, newStatus);
      setHistoryList(prev => prev.map(a => a.audit_id === auditId ? { ...a, status: newStatus } : a));
      showToast(`Audit ${auditId} marked as ${newStatus}`, 'success');
    } catch (err) {
      showToast('Status update error: ' + err.message, 'error');
    }
  };

  const handleDeleteAudit = async (auditId) => {
    if (!confirm(t('confirmDelete'))) return;
    try {
      await deleteAudit(auditId);
      setHistoryList(prev => prev.filter(a => a.audit_id !== auditId));
      showToast(`Audit ${auditId} deleted`, 'info');
    } catch (err) {
      showToast('Delete error: ' + err.message, 'error');
    }
  };

  const handleExportCsv = (audit, details) => {
    if (!details || details.length === 0) return;
    let csv = '\uFEFFIngredient,Type,Quantity,Unit\n';
    for (const d of details) {
      csv += `"${d.ingredient_name}","${d.product_type}",${d.count_quantity},"${d.unit}"\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_${audit.store_code}_${audit.audit_date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── TOAST ─────────────────────────────────────────────────────────────────

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ─── COMPUTED STATS & CATEGORIES ──────────────────────────────────────────

  const categoryList = useMemo(() => {
    const countsPerCat = {};
    ingredients.forEach(i => {
      const cat = i.supplier_name || 'other';
      countsPerCat[cat] = (countsPerCat[cat] || 0) + 1;
    });
    const keys = Object.keys(countsPerCat).sort((a, b) => countsPerCat[b] - countsPerCat[a]);
    return [
      { key: 'all', label: t('allCategories'), icon: '✨', count: ingredients.length },
      ...keys.map(k => {
        const meta = CATEGORY_MAP[k.trim().toUpperCase()] || { ru: k, en: k, icon: '📦' };
        return {
          key: k,
          label: lang === 'ru' ? meta.ru : meta.en,
          icon: meta.icon,
          count: countsPerCat[k]
        };
      })
    ];
  }, [ingredients, lang, t]);

  const filteredIngredients = useMemo(() => {
    const q = search.toLowerCase().trim();
    return ingredients.filter(i => {
      const cat = i.supplier_name || 'other';
      const matchCat = selectedCategory === 'all' || cat === selectedCategory;
      const matchSearch = !q || i.ingredient_name.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [ingredients, search, selectedCategory]);

  const filledCount = useMemo(() => {
    return ingredients.filter(i => counts[i.ingredient_id] !== undefined && counts[i.ingredient_id] !== '').length;
  }, [ingredients, counts]);

  // ─── RENDER LOGIN SCREEN IF NO ROLE ────────────────────────────────────────

  if (!role) {
    return <LoginScreen onLogin={handleLogin} t={t} lang={lang} onToggleLang={toggleLang} />;
  }

  const selectedStore = stores.find(s => s.store_id === selectedStoreId);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
      {/* ── Top App Bar (Mobile-first, Uncrammed) ────────────────────────── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-xl mx-auto px-3 sm:px-4 h-13 sm:h-14 flex items-center justify-between gap-2">
          {/* Left: Brand & Store Title */}
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-xl sm:text-2xl shrink-0">📝</span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-slate-900 tracking-tight text-sm sm:text-base whitespace-nowrap">
                  {t('appTitle')}
                </span>
                <span className={`text-[9px] sm:text-[10px] uppercase font-extrabold px-1.5 py-0.5 rounded-full shrink-0 ${
                  role === 'manager' 
                    ? 'bg-purple-100 text-purple-700 border border-purple-200/60' 
                    : 'bg-blue-100 text-blue-700 border border-blue-200/60'
                }`}>
                  {role === 'manager' ? (lang === 'ru' ? 'Менеджер' : 'Manager') : (lang === 'ru' ? 'Бариста' : 'Barista')}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium truncate leading-tight mt-0.5 flex items-center gap-1">
                <span>📍</span> <span>{selectedStore ? selectedStore.store_name : ''}</span>
              </p>
            </div>
          </div>

          {/* Right: Controls (Language + Sign out) */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Language Switcher */}
            <button
              onClick={toggleLang}
              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors"
            >
              {lang.toUpperCase()}
            </button>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="text-xs text-slate-500 hover:text-red-600 px-2 py-1 rounded-lg border border-transparent hover:border-slate-200 transition-colors flex items-center gap-1 whitespace-nowrap"
              title={t('signOut')}
            >
              <span className="text-sm">🚪</span>
              <span className="hidden sm:inline font-medium">{t('signOut')}</span>
            </button>
          </div>
        </div>

        {/* Manager Mode: Dedicated Segmented Control Bar */}
        {role === 'manager' && (
          <div className="bg-slate-100/70 border-t border-slate-200/70 px-3 py-1.5">
            <div className="max-w-md mx-auto grid grid-cols-2 bg-slate-200/80 p-0.5 rounded-xl text-xs font-bold">
              <button
                onClick={() => setActiveTab('count')}
                className={`py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'count'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>📝</span>
                <span>{t('countTab')}</span>
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'history'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>🕒</span>
                <span>{t('historyTab')}</span>
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── Main View Container ─────────────────────────────────────────── */}
      <main className="max-w-xl mx-auto w-full px-3 sm:px-4 py-3 sm:py-4 flex-1">
        {loadingInitial ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <span className="animate-spin text-2xl mr-2">⏳</span> Loading catalog...
          </div>
        ) : activeTab === 'count' ? (
          /* ── COUNT VIEW ────────────────────────────────────────────────── */
          <div className="space-y-3 sm:space-y-4">
            {/* Editing Notice Banner */}
            {editingAuditId && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 px-3.5 py-2.5 rounded-2xl flex items-center justify-between text-xs font-medium shadow-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base shrink-0">✏️</span>
                  <span className="truncate">
                    <strong>{t('editingNotice')}:</strong> <span className="font-mono font-bold">{editingAuditId}</span> ({selectedStore?.store_name})
                  </span>
                </div>
                <button
                  onClick={handleCancelEdit}
                  className="bg-amber-200/70 hover:bg-amber-200 text-amber-900 px-2 py-1 rounded-lg font-bold transition-colors shrink-0 ml-2"
                >
                  ✕ {t('cancelEdit')}
                </button>
              </div>
            )}

            {/* Header Control Panel (Store Selector, Date & Progress) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 shadow-xs space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                {/* Store Picker */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1">
                    <span>📍</span> <span>{t('selectStore')}</span>
                  </label>
                  <div className="relative">
                    <select
                      value={selectedStoreId || ''}
                      onChange={e => setSelectedStoreId(Number(e.target.value))}
                      className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-800 text-xs sm:text-sm font-bold rounded-xl px-2.5 sm:px-3 py-2 pr-7 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-colors appearance-none cursor-pointer truncate"
                    >
                      {stores.map(s => (
                        <option key={s.store_id} value={s.store_id}>
                          {s.store_name} ({s.store_code})
                        </option>
                      ))}
                    </select>
                    <span className="absolute right-2.5 top-2.5 text-slate-400 pointer-events-none text-xs">▼</span>
                  </div>
                </div>

                {/* Date Picker */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1">
                    <span>📅</span> <span>{t('auditDate')}</span>
                  </label>
                  <input
                    type="date"
                    value={auditDate}
                    onChange={e => setAuditDate(e.target.value)}
                    className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-800 text-xs sm:text-sm font-semibold rounded-xl px-2 sm:px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              {/* Progress Tracker */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-600">
                    {t('fillProgress')}: <span className="font-black text-blue-600">{filledCount}</span> / {ingredients.length}
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/50">
                    {Math.round((filledCount / (ingredients.length || 1)) * 100)}%
                  </span>
                </div>

                {filledCount > 0 && (
                  <button
                    onClick={handleClearDraft}
                    className="text-[11px] font-medium text-slate-400 hover:text-red-500 transition-colors"
                  >
                    {t('clearDraft')}
                  </button>
                )}
              </div>

              {/* Progress Bar Track */}
              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden -mt-1">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-indigo-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${(filledCount / (ingredients.length || 1)) * 100}%` }}
                />
              </div>
            </div>

            {/* Filter Bar (Search + Categories) */}
            <div className="space-y-2">
              <div className="relative">
                <input
                  type="text"
                  placeholder={t('searchPlaceholder')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 pl-9 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs"
                />
                <span className="absolute left-3 top-2 text-slate-400 text-sm">🔍</span>
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-3 top-2 text-slate-400 text-xs font-bold">✕</button>
                )}
              </div>

              {/* Category Pills (With real names & icons) */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
                {categoryList.map(cat => (
                  <button
                    key={cat.key}
                    onClick={() => setSelectedCategory(cat.key)}
                    className={`text-xs px-2.5 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shrink-0 ${
                      selectedCategory === cat.key
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white border border-slate-200/90 text-slate-600 hover:bg-slate-100 shadow-2xs'
                    }`}
                  >
                    <span>{cat.icon}</span>
                    <span>{cat.label}</span>
                    <span className={`text-[10px] px-1 rounded-full font-mono ${
                      selectedCategory === cat.key ? 'bg-slate-700 text-slate-200' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {cat.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Ingredients List (Ergonomic & Satisfying) ────────────────── */}
            <div className="space-y-2">
              {filteredIngredients.map(ing => {
                const currentVal = counts[ing.ingredient_id] ?? '';
                const lastVal = lastAuditBaseline.counts[ing.ingredient_id];
                const hasLast = lastVal !== undefined && lastVal !== null;
                const isFilled = currentVal !== '' && currentVal !== null && currentVal !== undefined;
                
                // Flag large variance (>40% difference) - STRICTLY for Manager review
                let isVarianceFlagged = false;
                let variancePercent = 0;
                if (role === 'manager' && isFilled && hasLast) {
                  const curr = parseFloat(currentVal);
                  const prev = parseFloat(lastVal);
                  if (prev === 0 && curr > 5) {
                    isVarianceFlagged = true;
                    variancePercent = '+100';
                  } else if (prev > 0) {
                    const diff = curr - prev;
                    const pct = Math.round((diff / prev) * 100);
                    if (Math.abs(pct) >= 40 && Math.abs(diff) >= 5) {
                      isVarianceFlagged = true;
                      variancePercent = pct > 0 ? `+${pct}` : `${pct}`;
                    }
                  }
                }

                return (
                  <div 
                    key={ing.ingredient_id}
                    className={`rounded-2xl border p-3 flex items-center justify-between gap-3 transition-all ${
                      isVarianceFlagged 
                        ? 'border-amber-300 bg-amber-50/40 shadow-xs' 
                        : isFilled 
                          ? 'border-blue-300 bg-blue-50/20 shadow-xs ring-1 ring-blue-500/10' 
                          : 'border-slate-200 bg-white hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    {/* Item Information */}
                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm tracking-tight leading-snug">
                          {ing.ingredient_name}
                        </span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200/60 uppercase shrink-0">
                          {ing.unit}
                        </span>
                        {isFilled && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 shrink-0 flex items-center gap-0.5">
                            ✓
                          </span>
                        )}
                        {isVarianceFlagged && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-900 shrink-0">
                            ⚠️ {variancePercent}%
                          </span>
                        )}
                      </div>

                      {/* Baseline previous count - STRICTLY for Manager (Blind Count for Baristas) */}
                      {role === 'manager' && (
                        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                          {hasLast ? (
                            <span>
                              {t('previousCount')}: <strong className="text-slate-600 font-semibold">{formatNumber(lastVal)}</strong> {ing.unit}
                            </span>
                          ) : (
                            <span className="italic text-slate-300">{t('previousCount')}: —</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Numeric Input */}
                    <div className="shrink-0 flex items-center gap-1.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]*"
                        placeholder="—"
                        value={currentVal}
                        onChange={e => handleCountChange(ing.ingredient_id, e.target.value)}
                        className={`w-24 sm:w-28 py-2 px-2.5 text-right font-extrabold text-base sm:text-lg rounded-xl border focus:outline-none transition-all ${
                          isFilled
                            ? 'bg-blue-50/70 border-blue-400 text-blue-950 focus:ring-2 focus:ring-blue-500 focus:bg-white'
                            : 'bg-slate-50/80 border-slate-200 text-slate-800 placeholder:text-slate-300 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-500'
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Submit Sticky Bar */}
            <div className="sticky bottom-4 pt-2">
              <button
                onClick={handleSubmitAudit}
                disabled={saving}
                className={`w-full py-3.5 font-bold rounded-2xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-[0.99] disabled:opacity-50 text-white ${
                  editingAuditId
                    ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-500/25 ring-2 ring-amber-400/40'
                    : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/25'
                }`}
              >
                {saving ? (
                  <span>⏳ {t('saving')}</span>
                ) : (
                  <>
                    <span>{editingAuditId ? '🔄' : '✓'}</span>
                    <span className="text-base tracking-wide">
                      {editingAuditId ? `${t('updateCount')} (${editingAuditId})` : `${t('saveCount')} (${filledCount} ${t('itemsCounted')})`}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* ── HISTORY VIEW (MANAGER) ─────────────────────────────────────── */
          <div className="space-y-4">
            {/* History Filter Bar */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500 uppercase">{t('selectStore')}:</span>
                <select
                  value={historyFilterStore}
                  onChange={e => setHistoryFilterStore(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-slate-800 text-sm font-medium rounded-xl px-3 py-1.5 focus:outline-none"
                >
                  <option value="all">All Stores</option>
                  {stores.map(s => (
                    <option key={s.store_id} value={s.store_id}>{s.store_name} ({s.store_code})</option>
                  ))}
                </select>
              </div>

              <button
                onClick={loadHistory}
                className="text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors font-medium"
              >
                ↻ Refresh
              </button>
            </div>

            {/* History List */}
            {loadingHistory ? (
              <div className="text-center py-12 text-slate-400">Loading audit history...</div>
            ) : historyList.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
                {t('noAuditsFound')}
              </div>
            ) : (
              <div className="space-y-3">
                {historyList.map(audit => {
                  const isExpanded = expandedAuditId === audit.audit_id;
                  const details = auditDetailsMap[audit.audit_id] || [];

                  return (
                    <div key={audit.audit_id} className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                      <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-600 font-bold">
                            {audit.audit_id}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-sm">{audit.store_name}</span>
                              <span className="text-xs text-slate-400">({audit.store_code})</span>
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                              <span>📅 {audit.audit_date}</span>
                              <span>• {audit.items_counted} items ({audit.total_units} units)</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 justify-end">
                          {/* Status Badge */}
                          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                            audit.status === 'approved' 
                              ? 'bg-emerald-100 text-emerald-800' 
                              : audit.status === 'rejected'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-amber-100 text-amber-800'
                          }`}>
                            {audit.status === 'approved' ? t('statusApproved') : audit.status === 'rejected' ? t('statusRejected') : t('statusPending')}
                          </span>

                          {/* Approval Actions */}
                          {audit.status !== 'approved' && (
                            <button
                              onClick={() => handleStatusChange(audit.audit_id, 'approved')}
                              className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2 py-1 rounded-md transition-colors"
                            >
                              ✓ {t('approve')}
                            </button>
                          )}
                          {audit.status !== 'rejected' && (
                            <button
                              onClick={() => handleStatusChange(audit.audit_id, 'rejected')}
                              className="text-xs bg-red-50 hover:bg-red-100 text-red-700 px-2 py-1 rounded-md transition-colors"
                            >
                              ✕ {t('reject')}
                            </button>
                          )}

                          {/* Edit / Update Button */}
                          <button
                            onClick={() => handleStartEdit(audit)}
                            className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200/80 font-bold px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-2xs"
                            title={t('updateCount')}
                          >
                            <span>✏️</span>
                            <span>{t('updateCount')}</span>
                          </button>

                          {/* Details Toggle */}
                          <button
                            onClick={() => toggleExpandAudit(audit.audit_id)}
                            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-3 py-1.5 rounded-lg transition-colors"
                          >
                            {isExpanded ? t('hideDetails') : t('viewDetails')}
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteAudit(audit.audit_id)}
                            className="text-xs text-slate-400 hover:text-red-600 p-1 rounded transition-colors"
                            title="Delete"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>

                      {/* Expanded Drilldown */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                          <div className="flex justify-between items-center mb-3">
                            <span className="text-xs font-semibold text-slate-600">Recorded Counts ({details.length} positions)</span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleStartEdit(audit)}
                                className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-xs"
                              >
                                <span>✏️</span>
                                <span>{t('updateCount')}</span>
                              </button>
                              <button
                                onClick={() => handleExportCsv(audit, details)}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1"
                              >
                                📥 {t('exportCsv')}
                              </button>
                            </div>
                          </div>

                          {details.length === 0 ? (
                            <div className="text-xs text-slate-400 py-2">Loading line details...</div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-80 overflow-y-auto pr-1">
                              {details.map(d => (
                                <div key={d.ingredient_id} className="bg-white border border-slate-200 rounded-lg p-2 text-xs flex justify-between items-center">
                                  <span className="truncate mr-2 font-medium text-slate-800">{d.ingredient_name}</span>
                                  <span className="font-mono font-bold text-slate-900 whitespace-nowrap">
                                    {d.count_quantity} <span className="font-normal text-slate-400">{d.unit}</span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Toast Notification ──────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 animate-bounce ${
          toast.type === 'success' 
            ? 'bg-emerald-600 text-white' 
            : toast.type === 'error' 
              ? 'bg-red-600 text-white' 
              : 'bg-slate-800 text-white'
        }`}>
          <span>{toast.type === 'success' ? '✓' : toast.type === 'error' ? '⚠️' : 'ℹ️'}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

// ─── LOGIN KEYPAD SCREEN ─────────────────────────────────────────────────────

function LoginScreen({ onLogin, t, lang, onToggleLang }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleDigit = (digit) => {
    setError(false);
    if (pin.length < 6) {
      const next = pin + digit;
      setPin(next);
      if (next.length === 4) {
        const ok = onLogin(next);
        if (!ok) {
          setError(true);
          setPin('');
        }
      }
    }
  };

  const handleBackspace = () => {
    setError(false);
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setError(false);
    setPin('');
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 select-none">
      <div className="absolute top-4 right-4">
        <button
          onClick={onToggleLang}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
        >
          {lang.toUpperCase()}
        </button>
      </div>

      <div className="bg-slate-800/80 backdrop-blur-md border border-slate-700 rounded-3xl p-8 w-full max-w-sm text-center shadow-2xl">
        <span className="text-4xl block mb-2">📝</span>
        <h1 className="text-xl font-bold text-white tracking-tight">{t('pinTitle')}</h1>
        <p className="text-xs text-slate-400 mt-1 mb-6">{t('pinSubtitle')}</p>

        {/* PIN Dots */}
        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2, 3].map(idx => (
            <div
              key={idx}
              className={`w-3.5 h-3.5 rounded-full border border-slate-500 transition-all ${
                pin.length > idx ? 'bg-blue-400 border-blue-400 scale-110' : 'bg-transparent'
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-xs text-red-400 mb-4 animate-shake">{t('incorrectPin')}</p>
        )}

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-3 max-w-[260px] mx-auto">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <button
              key={d}
              onClick={() => handleDigit(d)}
              className="h-14 rounded-2xl bg-slate-700/60 hover:bg-slate-700 text-white text-xl font-semibold active:scale-95 transition-all shadow-sm"
            >
              {d}
            </button>
          ))}
          <button
            onClick={handleClear}
            className="h-14 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-medium active:scale-95 transition-all"
          >
            C
          </button>
          <button
            onClick={() => handleDigit('0')}
            className="h-14 rounded-2xl bg-slate-700/60 hover:bg-slate-700 text-white text-xl font-semibold active:scale-95 transition-all shadow-sm"
          >
            0
          </button>
          <button
            onClick={handleBackspace}
            className="h-14 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-base active:scale-95 transition-all"
          >
            ⌫
          </button>
        </div>
      </div>
    </div>
  );
}

