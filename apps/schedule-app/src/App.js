import React, { useState, useEffect, useMemo } from "react";
import {
  Calendar,
  Search,
  RefreshCw,
  LogOut,
  Clock,
  AlertCircle,
  X,
  Store,
  Sun,
  Moon,
  CalendarDays,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Shield,
  Coffee,
  Smartphone,
  Download,
  Share,
  CheckCircle,
  User,
} from "lucide-react";

// Google Sheets CSV feed
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQEUW3vd8VtYtI7vy_wpMeATDMZDuW5-y4u7jmyw0qlEaBSZ8fBdNnFKMl1yTwJmQ8mRVC2jvE812b9/pub?gid=1943990106&single=true&output=csv";

export default function App() {
  const [rawData, setRawData] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSyncTime, setLastSyncTime] = useState(null);

  // Authentication & Role ('employee' | 'manager' | 'owner')
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem("bobaScheduleAuth") === "true";
  });
  const [role, setRole] = useState(() => {
    return sessionStorage.getItem("bobaScheduleRole") || "employee";
  });
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const isOwner = role === "owner";
  const isManager = role === "manager" || isOwner;

  // Persistent Selected Employee Name ('all' means manager viewing all shifts)
  const [selectedUser, setSelectedUser] = useState(() => {
    return localStorage.getItem("boba_schedule_user") || null;
  });
  const [isChangingUser, setIsChangingUser] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [shiftsSearchQuery, setShiftsSearchQuery] = useState("");

  const isAllShifts = isManager && (selectedUser === "all" || selectedUser === "Управляющий (Все смены)");

  // Navigation: 'myShifts' | 'calendar' | 'roster' (manager only)
  const [activeTab, setActiveTab] = useState("myShifts");
  const [drawerOpen, setDrawerOpen] = useState(false);

  // PWA Add to Home Screen State
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(() => {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  });
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [guidePlatform, setGuidePlatform] = useState(() => {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream ? "ios" : "android";
  });
  const [installBannerDismissed, setInstallBannerDismissed] = useState(() => {
    return localStorage.getItem("boba_install_banner_dismissed") === "true";
  });

  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === "accepted") {
          setDeferredPrompt(null);
          setInstallModalOpen(false);
          return;
        }
      } catch (e) {
        console.warn("Install prompt error:", e);
      }
    }
    setInstallModalOpen(true);
  };

  // Filters & State
  const [shiftsFilter, setShiftsFilter] = useState("upcoming"); // 'upcoming' | 'past'
  const [selectedStore, setSelectedStore] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => {
    return new Date().toISOString().slice(0, 10);
  });

  // Calendar month state
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchSheetData();
    }
  }, [isAuthenticated]);

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    setPasswordError("");
    const pin = passwordInput.trim();
    const _P = window.BC_PINS || {};
    const ownerPins = [_P.master || "7530"];
    const managerPins = [_P.inv_manager || _P.inv_logistics || "9876"];
    const employeePins = [_P.schedule || "2233"];

    if (ownerPins.includes(pin)) {
      setRole("owner");
      sessionStorage.setItem("bobaScheduleRole", "owner");
      setIsAuthenticated(true);
      sessionStorage.setItem("bobaScheduleAuth", "true");
      setPasswordInput("");
      setSelectedUser("all");
      localStorage.setItem("boba_schedule_user", "all");
    } else if (managerPins.includes(pin)) {
      setRole("manager");
      sessionStorage.setItem("bobaScheduleRole", "manager");
      setIsAuthenticated(true);
      sessionStorage.setItem("bobaScheduleAuth", "true");
      setPasswordInput("");
      setSelectedUser("all");
      localStorage.setItem("boba_schedule_user", "all");
    } else if (employeePins.includes(pin)) {
      setRole("employee");
      sessionStorage.setItem("bobaScheduleRole", "employee");
      setIsAuthenticated(true);
      sessionStorage.setItem("bobaScheduleAuth", "true");
      setPasswordInput("");
      if (selectedUser === "all") {
        setSelectedUser(null);
        localStorage.removeItem("boba_schedule_user");
      }
    } else {
      setPasswordError("Неверный пароль. Попробуйте снова.");
      setPasswordInput("");
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("bobaScheduleAuth");
    sessionStorage.removeItem("bobaScheduleRole");
    setIsAuthenticated(false);
    setDrawerOpen(false);
  };

  const selectEmployee = (name) => {
    setSelectedUser(name);
    localStorage.setItem("boba_schedule_user", name);
    setIsChangingUser(false);
  };

  // --- DATA FETCHING ---
  const fetchSheetData = async () => {
    setIsLoading(true);
    setError("");

    const fetchWithTimeout = async (url, options = {}, timeout = 8000) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
      } catch (e) {
        clearTimeout(id);
        throw e;
      }
    };

    try {
      let response = await fetchWithTimeout(SHEET_URL);
      if (!response.ok) {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(SHEET_URL)}`;
        const proxyResponse = await fetchWithTimeout(proxyUrl);
        const proxyData = await proxyResponse.json();
        if (proxyData.contents) {
          processRawData(proxyData.contents);
          return;
        }
        throw new Error("Could not fetch via proxy");
      }
      const text = await response.text();
      processRawData(text);
    } catch (err) {
      console.error("Fetch error:", err);
      setError("Не удалось загрузить данные графика. Проверьте подключение к сети.");
      setIsLoading(false);
    }
  };

  const processRawData = (text) => {
    if (text.trim().startsWith("<!DOCTYPE html>")) {
      setError("Ошибка: получена страница HTML вместо данных.");
      setIsLoading(false);
      return;
    }
    setRawData(text);
    setLastSyncTime(new Date());
    setIsLoading(false);
  };

  // --- PARSE SHIFTS ---
  const { allShifts, employeeNames, storesList } = useMemo(() => {
    if (!rawData) {
      return { allShifts: [], employeeNames: [], storesList: [] };
    }
    try {
      const rows = rawData.trim().split(/\r?\n/);
      if (rows.length < 2) {
        return { allShifts: [], employeeNames: [], storesList: [] };
      }

      const headers = rows[0].split(/,|\t/).map((h) => h.trim().replace(/^"|"$/g, ""));
      const shifts = [];
      const namesSet = new Set();
      const storesSet = new Set();

      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].split(/,|\t/).map((c) => c.trim().replace(/^"|"$/g, ""));
        const date = cells[0];
        if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) continue;

        for (let colIndex = 1; colIndex < headers.length; colIndex++) {
          const employeeName = cells[colIndex];
          const header = headers[colIndex];
          if (
            !employeeName ||
            !header ||
            ["—", "-", "", "off", "вых", "null", "undefined"].includes(employeeName.toLowerCase()) ||
            employeeName.startsWith("#") ||
            header.startsWith("#")
          ) {
            continue;
          }

          let store = header;
          let time = "Смена";
          if (header.includes("-")) {
            const parts = header.split("-");
            time = parts.pop().trim();
            store = parts.join("-").trim();
          }

          if (store.startsWith("#")) continue;

          storesSet.add(store);
          namesSet.add(employeeName);

          shifts.push({
            id: `${date}_${store}_${time}_${employeeName}`,
            name: employeeName,
            date,
            store,
            time,
          });
        }
      }

      // Sort Russian names alphabetically
      const sortedNames = Array.from(namesSet)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "ru"));

      const sortedStores = Array.from(storesSet)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "ru"));

      return {
        allShifts: shifts,
        employeeNames: sortedNames,
        storesList: sortedStores,
      };
    } catch (e) {
      console.error("Error parsing shifts:", e);
      return { allShifts: [], employeeNames: [], storesList: [] };
    }
  }, [rawData]);

  useEffect(() => {
    if (storesList.length > 0 && !selectedStore) {
      setSelectedStore(storesList[0]);
    }
  }, [storesList, selectedStore]);

  // Selected User's Shifts (or All Shifts for Manager)
  const userShifts = useMemo(() => {
    if (isAllShifts) {
      return [...allShifts].sort((a, b) => a.date.localeCompare(b.date));
    }
    if (!selectedUser || selectedUser === "all") return [];
    return allShifts
      .filter((s) => s.name === selectedUser)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [allShifts, selectedUser, isAllShifts]);

  const filteredUserShifts = useMemo(() => {
    if (!shiftsSearchQuery.trim()) return userShifts;
    const q = shiftsSearchQuery.toLowerCase();
    return userShifts.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.store.toLowerCase().includes(q) ||
      s.time.toLowerCase().includes(q)
    );
  }, [userShifts, shiftsSearchQuery]);

  const upcomingUserShifts = useMemo(() => {
    return filteredUserShifts.filter((s) => s.date >= todayStr);
  }, [filteredUserShifts, todayStr]);

  const pastUserShifts = useMemo(() => {
    return filteredUserShifts.filter((s) => s.date < todayStr).reverse();
  }, [filteredUserShifts, todayStr]);

  const nextShift = upcomingUserShifts[0] || null;

  // Helpers
  const formatDateBadge = (dateString) => {
    const d = new Date(dateString);
    const dayNum = d.getDate();
    const monthName = d.toLocaleDateString("ru-RU", { month: "short" }).toUpperCase();
    const weekdayName = d.toLocaleDateString("ru-RU", { weekday: "long" });
    return { dayNum, monthName, weekdayName };
  };

  const getRelativeDayBadge = (dateString) => {
    if (dateString === todayStr) return { text: "Сегодня", color: "bg-green-100 text-green-700 border-green-200" };
    const today = new Date(todayStr);
    const target = new Date(dateString);
    const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return { text: "Завтра", color: "bg-blue-100 text-blue-700 border-blue-200" };
    if (diffDays > 1 && diffDays <= 7) return { text: `Через ${diffDays} дн.`, color: "bg-slate-100 text-slate-700 border-slate-200" };
    return null;
  };

  // Group names by Russian alphabet initial letter
  const groupedNames = useMemo(() => {
    const filtered = employeeNames.filter((name) =>
      name.toLowerCase().includes(userSearchQuery.toLowerCase())
    );
    const groups = {};
    filtered.forEach((name) => {
      const initial = name.charAt(0).toUpperCase();
      if (!groups[initial]) groups[initial] = [];
      groups[initial].push(name);
    });
    return groups;
  }, [employeeNames, userSearchQuery]);

  // ─── 1. LOGIN SCREEN ─────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50/50 to-slate-100 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200/80 p-8">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/25">
              <Calendar className="w-8 h-8" />
            </div>
          </div>
          <h1 className="text-2xl font-extrabold text-center text-slate-900 tracking-tight">Boba Cafe</h1>
          <p className="text-center text-slate-500 text-xs font-semibold uppercase tracking-wider mt-1 mb-8">
            График Работы
          </p>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                Пароль сотрудника или управляющего
              </label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Введите PIN код..."
                className="w-full px-4 py-3.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 text-slate-900 font-medium text-base transition-all"
                autoFocus
              />
            </div>

            {passwordError && (
              <div className="p-3 bg-red-50 text-red-700 rounded-xl flex items-start gap-2 border border-red-200 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl font-bold transition-all shadow-md shadow-blue-500/20 text-sm flex items-center justify-center gap-2"
            >
              Войти в график
            </button>
          </form>

          {!isStandalone && (
            <div className="mt-4 pt-3 border-t border-slate-100 text-center">
              <button
                type="button"
                onClick={handleInstallClick}
                data-testid="login-install-btn"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors py-1"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Добавить на экран «Домой»</span>
              </button>
            </div>
          )}
        </div>

        <InstallGuideModal
          isOpen={installModalOpen}
          onClose={() => setInstallModalOpen(false)}
          deferredPrompt={deferredPrompt}
          onPromptInstall={handleInstallClick}
        />
      </div>
    );
  }

  // ─── 2. SORTED NAME SELECTION SCREEN ─────────────────────────────────────────
  if (!selectedUser || isChangingUser) {
    const letters = Object.keys(groupedNames).sort((a, b) => a.localeCompare(b, "ru"));

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-between max-w-md mx-auto">
        <header className="p-4 bg-white border-b border-slate-200/80 sticky top-0 z-20">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isManager ? "bg-purple-600" : "bg-blue-600"}`} />
              {isManager ? "Выбор режима или сотрудника" : "Выберите ваше имя"}
            </h1>
            {selectedUser && (
              <button
                onClick={() => setIsChangingUser(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500 mb-3">
            {isManager
              ? "Как управляющий, вы можете выбрать «Все смены» или любого конкретного сотрудника"
              : "Список отсортирован по алфавиту. Выберите себя, чтобы видеть только ваши смены"}
          </p>

          {/* MANAGER OPTION: All Shifts */}
          {isManager && (
            <button
              onClick={() => selectEmployee("all")}
              data-testid="select-manager-all-shifts"
              className={`w-full mb-3 p-3.5 rounded-2xl font-bold flex items-center justify-between transition-all active:scale-95 ${
                selectedUser === "all"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-500/25 ring-2 ring-purple-300"
                  : "bg-gradient-to-r from-purple-700 to-indigo-800 text-white shadow-sm hover:opacity-95"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-extrabold leading-tight">Управляющий: Все смены</p>
                  <p className="text-[11px] text-purple-200 mt-0.5">Показать смены всех сотрудников</p>
                </div>
              </div>
              <span className="text-xs bg-white/20 px-2.5 py-1 rounded-full font-bold">
                Все ({allShifts.length})
              </span>
            </button>
          )}

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={userSearchQuery}
              onChange={(e) => setUserSearchQuery(e.target.value)}
              placeholder="Поиск по имени или фамилии..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-100 rounded-xl text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus={!isManager}
            />
            {userSearchQuery && (
              <button
                onClick={() => setUserSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 overflow-y-auto space-y-4">
          {isLoading && (
            <div className="py-12 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
              Загрузка графика...
            </div>
          )}

          {letters.length === 0 && !isLoading && (
            <div className="py-12 text-center text-slate-400 text-sm">
              Сотрудник не найден
            </div>
          )}

          {letters.map((letter) => (
            <div key={letter} className="space-y-1.5">
              <p className="text-xs font-black text-blue-600 px-2 uppercase">{letter}</p>
              <div className="space-y-1.5">
                {groupedNames[letter].map((name) => {
                  const userUpcomingCount = allShifts.filter(
                    (s) => s.name === name && s.date >= todayStr
                  ).length;
                  return (
                    <button
                      key={name}
                      onClick={() => selectEmployee(name)}
                      className="w-full bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs flex items-center justify-between active:scale-95 transition-all hover:border-blue-300"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 font-bold flex items-center justify-center text-xs border border-blue-100">
                          {letter}
                        </div>
                        <span className="font-semibold text-slate-800 text-sm text-left">{name}</span>
                      </div>
                      <span className="text-[11px] font-medium text-slate-400">
                        {userUpcomingCount > 0 ? `${userUpcomingCount} смен` : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </main>

        <InstallGuideModal
          isOpen={installModalOpen}
          onClose={() => setInstallModalOpen(false)}
          deferredPrompt={deferredPrompt}
          onPromptInstall={handleInstallClick}
        />
      </div>
    );
  }

  // ─── 3. MAIN SCHEDULE APP VIEW ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col max-w-md mx-auto relative select-none">
      {/* ── Top Header ── */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 py-3 flex items-center justify-between sticky top-0 z-20 shadow-xs">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setDrawerOpen(true)}
            data-testid="header-drawer-toggle"
            className="p-1.5 -ml-1 text-slate-600 hover:text-slate-900 active:scale-90 transition-transform rounded-lg"
            aria-label="Открыть меню"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div>
            <h1 className="font-bold text-slate-900 text-sm leading-none flex items-center gap-1.5">
              <span>Boba Cafe</span>
              {isOwner ? (
                <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold border border-amber-200 flex items-center gap-1">
                  <Shield className="w-3 h-3 text-amber-600" />
                  Владелец
                </span>
              ) : isManager ? (
                <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold border border-purple-200 flex items-center gap-1">
                  <Shield className="w-3 h-3 text-purple-600" />
                  Управляющий
                </span>
              ) : (
                <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-semibold border border-blue-100">
                  График
                </span>
              )}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isStandalone && (
            <button
              onClick={handleInstallClick}
              data-testid="header-install-btn"
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold border border-blue-200/80 active:scale-95 transition-all"
              title="Добавить на экран «Домой»"
            >
              <Smartphone className="w-3.5 h-3.5 text-blue-600" />
              <span className="hidden xs:inline sm:inline">На экран «Домой»</span>
            </button>
          )}
          <button
            onClick={fetchSheetData}
            disabled={isLoading}
            className="p-2 text-slate-400 hover:text-blue-600 active:scale-90 rounded-lg transition-transform disabled:opacity-40"
            title="Обновить данные"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-blue-600" : ""}`} />
          </button>
          <button
            onClick={() => setIsChangingUser(true)}
            data-testid="header-user-btn"
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 active:scale-95 rounded-full transition-all text-xs font-semibold text-slate-700 border border-slate-200"
          >
            <span className={`w-2 h-2 rounded-full ${isAllShifts ? "bg-purple-600" : "bg-blue-600"}`} />
            <span className="truncate max-w-[120px]">
              {isAllShifts ? "Все смены" : (selectedUser ? selectedUser.split(" ")[0] : "Выбрать")}
            </span>
          </button>
        </div>
      </header>

      {/* ── Slide-Out Drawer ("More") ── */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] transition-opacity duration-300 ease-out ${
          drawerOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setDrawerOpen(false)}
      />
      <aside
        className={`w-72 bg-slate-800 text-white flex flex-col h-full fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          drawerOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        <div className="p-5 border-b border-slate-700 flex items-center justify-between">
          <div>
            <p className="font-bold text-base tracking-tight text-white">Boba Cafe</p>
            <p className="text-slate-400 text-xs mt-0.5">Личный кабинет графика</p>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1.5 -mr-1 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Profile Card */}
        <div className="p-4 mx-3 my-3 bg-slate-700/60 rounded-xl border border-slate-600 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full text-white font-bold flex items-center justify-center text-sm shadow-sm ${isAllShifts ? 'bg-purple-600' : 'bg-blue-500'}`}>
            {isAllShifts ? <Shield className="w-5 h-5" /> : (selectedUser ? selectedUser.charAt(0) : "U")}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-slate-400 uppercase font-semibold">
              {isOwner ? "Владелец" : isManager ? "Управляющий" : "Сотрудник"}
            </p>
            <p className="text-sm font-bold text-white truncate">
              {isAllShifts ? "Все сотрудники" : selectedUser}
            </p>
          </div>
          <button
            onClick={() => {
              setDrawerOpen(false);
              setIsChangingUser(true);
            }}
            className="text-[11px] font-semibold text-blue-300 hover:text-blue-100 underline"
          >
            Сменить
          </button>
        </div>

        {/* Add to Home Screen PWA Button */}
        {!isStandalone && (
          <div className="px-3 pb-2">
            <button
              onClick={() => {
                setDrawerOpen(false);
                handleInstallClick();
              }}
              data-testid="drawer-install-btn"
              className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-md shadow-blue-500/20 active:scale-95 transition-all text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                <Smartphone className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold leading-tight">Добавить на экран</p>
                <p className="text-[10px] text-blue-100 font-normal">Быстрый доступ как приложение</p>
              </div>
              <Download className="w-4 h-4 text-white/80" />
            </button>
          </div>
        )}

        {/* Drawer Links */}
        <div className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
          <button
            onClick={() => {
              setActiveTab("myShifts");
              setDrawerOpen(false);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm text-slate-200 hover:bg-slate-700 transition-colors"
          >
            <Calendar className="w-4 h-4 text-blue-400" />
            <span>Мои смены</span>
          </button>

          <button
            onClick={() => {
              setActiveTab("calendar");
              setDrawerOpen(false);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm text-slate-200 hover:bg-slate-700 transition-colors"
          >
            <CalendarDays className="w-4 h-4 text-amber-400" />
            <span>Календарь месяца</span>
          </button>

          {/* Manager-only feature */}
          {isManager && (
            <button
              onClick={() => {
                setActiveTab("roster");
                setDrawerOpen(false);
              }}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm text-slate-200 hover:bg-slate-700 transition-colors"
            >
              <Store className="w-4 h-4 text-emerald-400" />
              <span>Смены в филиале (Управляющий)</span>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 space-y-3">
          {lastSyncTime && (
            <div className="text-[10px] text-slate-400">
              Синхронизировано: {lastSyncTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold text-red-300 hover:text-red-100 hover:bg-red-900/30 rounded-lg transition-colors border border-red-800/40"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Выйти из аккаунта</span>
          </button>
        </div>
      </aside>

      {/* ── Main Tab Content with animate-page-enter ── */}
      <main key={activeTab} className="flex-1 p-4 pb-24 overflow-y-auto animate-page-enter">
        {error && (
          <div className="mb-4 p-3.5 bg-red-50 text-red-700 rounded-xl flex items-start gap-2.5 border border-red-200 text-xs font-medium">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── TAB 1: МОИ СМЕНЫ / ВСЕ СМЕНЫ ── */}
        {activeTab === "myShifts" && (
          <div className="space-y-4">
            {/* Install Banner */}
            {!isStandalone && !installBannerDismissed && (
              <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl p-4 shadow-md flex items-center justify-between gap-3 relative overflow-hidden border border-slate-700/60">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center flex-shrink-0 shadow-xs">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-white leading-tight">Установить на телефон</h4>
                    <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                      Работает как приложение без App Store
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={handleInstallClick}
                    data-testid="banner-install-btn"
                    className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-lg shadow-xs active:scale-95 transition-all"
                  >
                    Установить
                  </button>
                  <button
                    onClick={() => {
                      localStorage.setItem("boba_install_banner_dismissed", "true");
                      setInstallBannerDismissed(true);
                    }}
                    className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors"
                    title="Скрыть"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Manager View Switcher */}
            {isManager && (
              <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-3.5 rounded-2xl border border-slate-700/60 shadow-xs flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isAllShifts ? 'bg-purple-600' : 'bg-blue-600'} text-white`}>
                    <Shield className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                      {isOwner ? "Режим Владельца" : "Режим Управляющего"}
                    </p>
                    <p className="text-xs font-bold text-white truncate">
                      {isAllShifts ? "Опция: Все смены сотрудников" : `Сотрудник: ${selectedUser}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!isAllShifts ? (
                    <button
                      onClick={() => selectEmployee("all")}
                      data-testid="tab-switch-all-shifts"
                      className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold shadow-xs active:scale-95 transition-all flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3 text-amber-300" />
                      <span>Все смены</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setIsChangingUser(true)}
                      data-testid="tab-switch-select-employee"
                      className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold active:scale-95 transition-all"
                    >
                      Сотрудники
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Search filter when viewing all shifts */}
            {isAllShifts && (
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={shiftsSearchQuery}
                  onChange={(e) => setShiftsSearchQuery(e.target.value)}
                  placeholder="Поиск по имени сотрудника или филиалу..."
                  className="w-full pl-9 pr-8 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-2xs"
                />
                {shiftsSearchQuery && (
                  <button
                    onClick={() => setShiftsSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Hero Card: Next Shift */}
            {nextShift ? (
              <div className={`bg-gradient-to-br ${isAllShifts ? "from-purple-700 to-indigo-800 shadow-purple-500/20" : "from-blue-600 to-indigo-700 shadow-blue-500/20"} text-white rounded-2xl p-5 shadow-lg relative overflow-hidden`}>
                <div className="absolute right-0 top-0 -mr-6 -mt-6 w-32 h-32 bg-white/10 rounded-full blur-xl pointer-events-none" />
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-100">
                      {isAllShifts ? "Ближайшая смена в сети" : "Следующая смена"}
                    </span>
                  </div>
                  {getRelativeDayBadge(nextShift.date) && (
                    <span className="text-[11px] font-bold bg-white/20 text-white px-2.5 py-0.5 rounded-full backdrop-blur-xs">
                      {getRelativeDayBadge(nextShift.date).text}
                    </span>
                  )}
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-black tracking-tight leading-tight">
                      {nextShift.store}
                    </h2>
                    <p className="text-blue-100 text-xs font-medium mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-blue-200" />
                        {nextShift.time}
                      </span>
                      {isAllShifts && (
                        <span className="font-bold bg-white/20 px-2 py-0.5 rounded text-[11px]">
                          {nextShift.name}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="w-14 h-14 bg-white/15 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center border border-white/20 flex-shrink-0">
                    <span className="text-[10px] font-bold uppercase leading-none text-blue-200">
                      {formatDateBadge(nextShift.date).monthName}
                    </span>
                    <span className="text-xl font-black leading-none mt-0.5">
                      {formatDateBadge(nextShift.date).dayNum}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs text-center">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-2">
                  <Coffee className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-slate-800 text-base">Нет запланированных смен</h3>
                <p className="text-xs text-slate-400 mt-1">
                  {isAllShifts ? "В графике пока нет назначенных смен" : "У вас пока не запланировано смен в графике"}
                </p>
              </div>
            )}

            {/* Sub-tabs: Upcoming vs Past */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex bg-slate-200/80 p-1 rounded-xl gap-1">
                <button
                  onClick={() => setShiftsFilter("upcoming")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    shiftsFilter === "upcoming"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Предстоящие ({upcomingUserShifts.length})
                </button>
                <button
                  onClick={() => setShiftsFilter("past")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    shiftsFilter === "past"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Прошедшие ({pastUserShifts.length})
                </button>
              </div>
            </div>

            {/* List of Shifts */}
            <div className="space-y-2.5">
              {(shiftsFilter === "upcoming" ? upcomingUserShifts : pastUserShifts).map((shift) => {
                const { dayNum, monthName, weekdayName } = formatDateBadge(shift.date);
                const rel = getRelativeDayBadge(shift.date);
                const isNight = shift.time.toLowerCase().includes("ночь");

                return (
                  <div
                    key={shift.id}
                    className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs flex items-center justify-between gap-3 active:scale-95 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-slate-100 flex flex-col items-center justify-center flex-shrink-0 border border-slate-200">
                        <span className="text-[9px] font-bold text-slate-500 uppercase leading-none">
                          {monthName}
                        </span>
                        <span className="text-lg font-black text-slate-800 leading-none mt-0.5">
                          {dayNum}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-bold text-slate-900 text-sm leading-tight truncate">
                            {shift.store}
                          </p>
                          {isAllShifts && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
                              <User className="w-2.5 h-2.5" />
                              {shift.name}
                            </span>
                          )}
                          {rel && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${rel.color}`}>
                              {rel.text}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 capitalize mt-0.5">
                          {weekdayName} ·{" "}
                          <span className={`font-semibold ${isNight ? "text-indigo-600" : "text-amber-600"}`}>
                            {shift.time}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── TAB 2: КАЛЕНДАРЬ ── */}
        {activeTab === "calendar" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
                  {isAllShifts ? "Календарь всех смен" : "Мой календарь смен"}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 capitalize">
                  {currentMonth.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
                </p>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() =>
                    setCurrentMonth(
                      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
                    )
                  }
                  className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 active:scale-95"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() =>
                    setCurrentMonth(
                      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
                    )
                  }
                  className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 active:scale-95"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Calendar Grid */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
              <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-400 uppercase mb-2">
                <span>Пн</span>
                <span>Вт</span>
                <span>Ср</span>
                <span>Чт</span>
                <span>Пт</span>
                <span>Сб</span>
                <span>Вс</span>
              </div>

              {(() => {
                const year = currentMonth.getFullYear();
                const month = currentMonth.getMonth();
                const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
                const daysInMonth = new Date(year, month + 1, 0).getDate();

                const grid = [];
                for (let i = 0; i < firstDayIndex; i++) {
                  grid.push(null);
                }
                for (let d = 1; d <= daysInMonth; d++) {
                  const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                  grid.push({ day: d, dateStr });
                }

                return (
                  <div className="grid grid-cols-7 gap-1">
                    {grid.map((cell, idx) => {
                      if (!cell) return <div key={`empty-${idx}`} className="h-10" />;
                      const isToday = cell.dateStr === todayStr;
                      const isSelected = cell.dateStr === selectedDate;
                      const dayHasShifts = isAllShifts
                        ? allShifts.some((s) => s.date === cell.dateStr)
                        : userShifts.some((s) => s.date === cell.dateStr);

                      return (
                        <button
                          key={cell.dateStr}
                          onClick={() => setSelectedDate(cell.dateStr)}
                          className={`h-11 rounded-xl flex flex-col items-center justify-center relative transition-all active:scale-90 ${
                            isSelected
                              ? (isAllShifts ? "bg-purple-600 text-white font-black shadow-xs" : "bg-blue-600 text-white font-black shadow-xs")
                              : isToday
                              ? (isAllShifts ? "bg-purple-50 text-purple-700 font-bold border border-purple-200" : "bg-blue-50 text-blue-700 font-bold border border-blue-200")
                              : "text-slate-800 hover:bg-slate-100"
                          }`}
                        >
                          <span className="text-xs leading-none">{cell.day}</span>
                          {dayHasShifts && (
                            <span
                              className={`w-1.5 h-1.5 rounded-full mt-1 ${
                                isSelected ? "bg-white" : (isAllShifts ? "bg-purple-600" : "bg-blue-600")
                              }`}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Breakdown for Selected Date */}
            {(() => {
              const { dayNum, monthName, weekdayName } = formatDateBadge(selectedDate);
              const isToday = selectedDate === todayStr;

              if (isAllShifts) {
                const dayShifts = allShifts.filter((s) => s.date === selectedDate);
                return (
                  <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-3 animate-slide-in-right">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <div>
                        <span className="font-bold text-slate-900 text-sm capitalize">
                          {isToday ? "Сегодня" : `${dayNum} ${monthName}, ${weekdayName}`}
                        </span>
                        <p className="text-[11px] text-slate-400">{selectedDate}</p>
                      </div>
                      <span className="text-[11px] font-bold bg-purple-100 text-purple-700 px-2.5 py-0.5 rounded-full border border-purple-200">
                        Смен в сети: {dayShifts.length}
                      </span>
                    </div>

                    {dayShifts.length > 0 ? (
                      <div className="space-y-2">
                        {dayShifts.map((s) => (
                          <div
                            key={s.id}
                            className="p-3 bg-purple-50/60 border border-purple-200/80 rounded-xl flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="font-bold text-slate-900 text-xs truncate">{s.store}</p>
                                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-200/80 text-purple-900 truncate">
                                  {s.name}
                                </span>
                              </div>
                              <p className="text-[11px] text-purple-700 font-medium mt-0.5 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {s.time}
                              </p>
                            </div>
                            <span className="text-xs font-bold px-2 py-1 bg-white text-purple-800 rounded-lg shadow-2xs border border-purple-100 flex-shrink-0">
                              {s.time}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-4 text-center">
                        <p className="text-xs font-semibold text-slate-600">Нет назначенных смен на этот день</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Выходной день ☕</p>
                      </div>
                    )}
                  </div>
                );
              }

              const myShiftOnDate = userShifts.find((s) => s.date === selectedDate);
              return (
                <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-3 animate-slide-in-right">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <div>
                      <span className="font-bold text-slate-900 text-sm capitalize">
                        {isToday ? "Сегодня" : `${dayNum} ${monthName}, ${weekdayName}`}
                      </span>
                      <p className="text-[11px] text-slate-400">{selectedDate}</p>
                    </div>
                    {myShiftOnDate ? (
                      <span className="text-[11px] font-bold bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full border border-blue-200">
                        Рабочий день ✨
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-full border border-slate-200">
                        Выходной
                      </span>
                    )}
                  </div>

                  {myShiftOnDate ? (
                    <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="font-bold text-blue-950 text-sm">{myShiftOnDate.store}</p>
                        <p className="text-xs text-blue-700 font-medium mt-0.5 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {myShiftOnDate.time}
                        </p>
                      </div>
                      <span className="text-xs font-bold px-2.5 py-1 bg-white text-blue-800 rounded-lg shadow-2xs border border-blue-100">
                        {myShiftOnDate.time}
                      </span>
                    </div>
                  ) : (
                    <div className="py-4 text-center">
                      <p className="text-xs font-semibold text-slate-600">В этот день у вас нет смен</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Выходной день ☕</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── TAB 3: В ФИЛИАЛЕ (Store Roster - MANAGER ONLY) ── */}
        {isManager && activeTab === "roster" && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-purple-600" />
                <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">Смены в филиале</h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Кто работает на какой смене (режим управляющего)</p>
            </div>

            {/* Store Chips Carousel */}
            <div className="no-scrollbar flex overflow-x-auto gap-1.5 pb-1 -mx-4 px-4">
              {storesList.map((st) => (
                <button
                  key={st}
                  onClick={() => setSelectedStore(st)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all active:scale-95 flex-shrink-0 ${
                    selectedStore === st
                      ? "bg-purple-600 text-white shadow-xs"
                      : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* Date Quick Selector */}
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-xs"
              />
              <button
                onClick={() => setSelectedDate(todayStr)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  selectedDate === todayStr
                    ? "bg-purple-100 text-purple-700"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Сегодня
              </button>
            </div>

            {/* Roster for Selected Store & Date */}
            {(() => {
              const storeShiftsOnDate = allShifts.filter(
                (s) => s.store === selectedStore && s.date === selectedDate
              );

              if (storeShiftsOnDate.length === 0) {
                return (
                  <div className="bg-white rounded-2xl p-8 border border-slate-200/80 text-center shadow-xs">
                    <p className="text-sm font-semibold text-slate-600">На этот день смен нет</p>
                    <p className="text-xs text-slate-400 mt-1">
                      В филиале {selectedStore} нет назначенных смен на {selectedDate}
                    </p>
                  </div>
                );
              }

              // Group by shift time
              const byTime = {};
              storeShiftsOnDate.forEach((s) => {
                if (!byTime[s.time]) byTime[s.time] = [];
                byTime[s.time].push(s.name);
              });

              return (
                <div className="space-y-3">
                  {Object.entries(byTime).map(([timeSlot, employees]) => {
                    const isNight = timeSlot.toLowerCase().includes("ночь");

                    return (
                      <div
                        key={timeSlot}
                        className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs"
                      >
                        <div className="flex items-center gap-1.5 pb-2.5 mb-2.5 border-b border-slate-100">
                          {isNight ? (
                            <Moon className="w-4 h-4 text-indigo-500" />
                          ) : (
                            <Sun className="w-4 h-4 text-amber-500" />
                          )}
                          <span className="font-bold text-slate-800 text-sm">{timeSlot}</span>
                          <span className="text-xs text-slate-400 ml-auto">{employees.length} чел.</span>
                        </div>

                        <div className="space-y-2">
                          {employees.map((emp) => (
                            <div key={emp} className="flex items-center gap-2.5 text-sm">
                              <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs border border-slate-200">
                                {emp.charAt(0)}
                              </div>
                              <span className="font-semibold text-slate-800">{emp}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}
      </main>

      {/* ── Glassmorphic Bottom Navigation Bar ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 max-w-md mx-auto backdrop-blur-md bg-white/95 border-t border-gray-200/80 px-1 py-1 flex items-center justify-around shadow-[0_-4px_16px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom,0px)]">
        {/* Tab 1: Мои смены / Все смены */}
        <button
          onClick={() => setActiveTab("myShifts")}
          data-testid="bottom-nav-myShifts"
          className={`relative flex flex-col items-center justify-center flex-1 py-1 min-h-[48px] active:scale-90 transition-transform duration-150 select-none ${
            activeTab === "myShifts"
              ? isAllShifts ? "text-purple-600 font-semibold" : "text-blue-600 font-semibold"
              : "text-gray-500 hover:text-gray-900"
          }`}
        >
          <Calendar
            className={`w-5 h-5 transition-transform duration-200 ${
              activeTab === "myShifts" ? (isAllShifts ? "scale-110 text-purple-600" : "scale-110 text-blue-600") : "text-gray-500"
            }`}
          />
          <span className="text-[10px] mt-0.5 leading-tight text-center">
            {isAllShifts ? "Все смены" : "Мои смены"}
          </span>
          {activeTab === "myShifts" && (
            <span className={`absolute bottom-0.5 w-1 h-1 rounded-full ${isAllShifts ? 'bg-purple-600' : 'bg-blue-600'} transition-all duration-300`} />
          )}
        </button>

        {/* Tab 2 (Manager Only): В филиале */}
        {isManager && (
          <button
            onClick={() => setActiveTab("roster")}
            data-testid="bottom-nav-roster"
            className={`relative flex flex-col items-center justify-center flex-1 py-1 min-h-[48px] active:scale-90 transition-transform duration-150 select-none ${
              activeTab === "roster" ? "text-purple-600 font-semibold" : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <Store
              className={`w-5 h-5 transition-transform duration-200 ${
                activeTab === "roster" ? "scale-110 text-purple-600" : "text-gray-500"
              }`}
            />
            <span className="text-[10px] mt-0.5 leading-tight text-center">В филиале</span>
            {activeTab === "roster" && (
              <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-purple-600 transition-all duration-300" />
            )}
          </button>
        )}

        {/* Tab 3: Календарь */}
        <button
          onClick={() => setActiveTab("calendar")}
          data-testid="bottom-nav-calendar"
          className={`relative flex flex-col items-center justify-center flex-1 py-1 min-h-[48px] active:scale-90 transition-transform duration-150 select-none ${
            activeTab === "calendar" ? "text-blue-600 font-semibold" : "text-gray-500 hover:text-gray-900"
          }`}
        >
          <CalendarDays
            className={`w-5 h-5 transition-transform duration-200 ${
              activeTab === "calendar" ? "scale-110 text-blue-600" : "text-gray-500"
            }`}
          />
          <span className="text-[10px] mt-0.5 leading-tight text-center">Календарь</span>
          {activeTab === "calendar" && (
            <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-blue-600 transition-all duration-300" />
          )}
        </button>

        {/* Tab 4: Ещё */}
        <button
          onClick={() => setDrawerOpen(true)}
          data-testid="bottom-nav-more"
          className="relative flex flex-col items-center justify-center flex-1 py-1 min-h-[48px] text-gray-500 hover:text-gray-900 active:scale-90 transition-transform duration-150 select-none"
        >
          <svg className="w-5 h-5 text-gray-500 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span className="text-[10px] mt-0.5 leading-tight text-center">Ещё</span>
        </button>
      </nav>

      {/* PWA Install Guide Modal */}
      <InstallGuideModal
        isOpen={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        deferredPrompt={deferredPrompt}
        onPromptInstall={handleInstallClick}
      />
    </div>
  );
}

// ─── INSTALL GUIDE MODAL (iPhone / Android) ──────────────────────────────────
function InstallGuideModal({ isOpen, onClose, deferredPrompt, onPromptInstall }) {
  const [platform, setPlatform] = useState(() => {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream ? "ios" : "android";
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-page-enter">
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base leading-tight">Добавить на экран «Домой»</h3>
              <p className="text-xs text-slate-500">Работает как приложение</p>
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="close-install-modal"
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Platform Switcher Tabs */}
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex gap-2">
          <button
            onClick={() => setPlatform("ios")}
            data-testid="tab-guide-ios"
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              platform === "ios"
                ? "bg-white text-blue-700 shadow-xs border border-blue-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>iPhone (iOS Safari)</span>
          </button>
          <button
            onClick={() => setPlatform("android")}
            data-testid="tab-guide-android"
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              platform === "android"
                ? "bg-white text-blue-700 shadow-xs border border-blue-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>Android (Chrome)</span>
          </button>
        </div>

        {/* Steps Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {platform === "ios" ? (
            <div className="space-y-3.5 text-xs">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[11px] leading-relaxed">
                💡 <strong>Важно:</strong> Откройте сайт именно в <strong>Safari</strong> (в Telegram или Chrome на iPhone меню добавления недоступно).
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0 text-xs">
                  1
                </div>
                <div>
                  <p className="font-bold text-slate-800">Нажмите кнопку «Поделиться»</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    Иконка квадрата со стрелкой вверх в нижней панели Safari.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0 text-xs">
                  2
                </div>
                <div>
                  <p className="font-bold text-slate-800">Выберите «На экран "Домой"»</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    Прокрутите меню действий вниз до пункта со значком плюс <span className="font-semibold text-slate-700">⊞</span>.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0 text-xs">
                  3
                </div>
                <div>
                  <p className="font-bold text-slate-800">Нажмите «Добавить»</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    В правом верхнем углу окна подтверждения.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-[11px] flex items-center gap-2">
                <CheckCircle className="w-4 h-4 flex-shrink-0 text-emerald-600" />
                <span>Иконка Boba Cafe появится на рабочем столе как полноценное приложение!</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5 text-xs">
              {deferredPrompt ? (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-center space-y-2">
                  <p className="font-bold text-blue-900 text-sm">Готово к автоматической установке!</p>
                  <p className="text-blue-700 text-xs">
                    Ваш браузер поддерживает быструю установку в один клик.
                  </p>
                  <button
                    onClick={onPromptInstall}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold rounded-lg shadow-sm text-xs flex items-center justify-center gap-1.5 transition-all mt-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Установить прямо сейчас</span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0 text-xs">
                      1
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">Откройте меню браузера</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        Нажмите три точки <span className="font-bold text-slate-700">⋮</span> в правом верхнем углу Chrome или Яндекс Браузера.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0 text-xs">
                      2
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">Выберите «Установить приложение»</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        Или «Добавить на главный экран».
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0 text-xs">
                      3
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">Подтвердите установку</p>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        Приложение установится на домашний экран и будет открываться без адресной строки браузера.
                      </p>
                    </div>
                  </div>
                </>
              )}

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-[11px] flex items-center gap-2">
                <CheckCircle className="w-4 h-4 flex-shrink-0 text-emerald-600" />
                <span>Приложение будет работать быстро и без ограничений App Store!</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            data-testid="modal-done-btn"
            className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl active:scale-95 transition-all"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}
