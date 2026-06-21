import React, { useState, useEffect, useMemo } from "react";
import {
  Calendar,
  MapPin,
  Search,
  RefreshCw,
  LogOut,
  Clock,
  AlertCircle,
} from "lucide-react";

// --- DATA SOURCE ---
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQEUW3vd8VtYtI7vy_wpMeATDMZDuW5-y4u7jmyw0qlEaBSZ8fBdNnFKMl1yTwJmQ8mRVC2jvE812b9/pub?gid=1943990106&single=true&output=csv";

const App = () => {
  const [rawData, setRawData] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");

  // --- STYLE INJECTION (Ensures Tailwind loads) ---
  useEffect(() => {
    if (!document.getElementById("tailwind-cdn")) {
      const script = document.createElement("script");
      script.id = "tailwind-cdn";
      script.src = "https://cdn.tailwindcss.com";
      document.head.appendChild(script);
    }

    const style = document.createElement("style");
    style.innerHTML = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
      body { font-family: 'Inter', sans-serif !important; }
    `;
    document.head.appendChild(style);

    // Check if already authenticated in session storage
    const authenticated = sessionStorage.getItem("bobaScheduleAuth");
    if (authenticated === "true") {
      setIsAuthenticated(true);
      fetchSheetData();
    }
  }, []);

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    setPasswordError("");

    const validPasswords = ["2233", "7530"];
    if (validPasswords.includes(passwordInput)) {
      setIsAuthenticated(true);
      sessionStorage.setItem("bobaScheduleAuth", "true");
      setPasswordInput("");
      fetchSheetData();
    } else {
      setPasswordError("Неверный пароль. Попробуйте снова.");
      setPasswordInput("");
    }
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
      setError("Не удалось загрузить данные. Проверьте публикацию таблицы.");
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
    setIsLoading(false);
  };

  // --- PARSING ---
  const parsedData = useMemo(() => {
    if (!rawData) return [];
    try {
      const rows = rawData.trim().split(/\r?\n/);
      if (rows.length < 2) return [];

      const headers = rows[0].split(/,|\t/).map(h => h.trim().replace(/^"|"$/g, ""));
      const shiftData = [];

      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].split(/,|\t/).map(c => c.trim().replace(/^"|"$/g, ""));
        const date = cells[0];
        if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) continue;

        for (let colIndex = 1; colIndex < headers.length; colIndex++) {
          const employeeName = cells[colIndex];
          const header = headers[colIndex];
          if (!employeeName || ["—", "-", "", "off", "вых"].includes(employeeName.toLowerCase())) continue;

          let store = header;
          let time = "Смена";
          if (header.includes("-")) {
            const parts = header.split("-");
            time = parts.pop().trim();
            store = parts.join("-").trim();
          }

          shiftData.push({ name: employeeName, date, store, time });
        }
      }
      return shiftData;
    } catch (e) {
      return [];
    }
  }, [rawData]);

  const employeeNames = useMemo(() => {
    const names = new Set(parsedData.map((d) => d.name));
    return Array.from(names).filter(Boolean).sort();
  }, [parsedData]);

  const userShifts = useMemo(() => {
    if (!selectedUser) return [];
    return parsedData
      .filter((d) => d.name === selectedUser)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [parsedData, selectedUser]);

  // Authentication screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-slate-50 text-slate-900 selection:bg-blue-100 selection:text-blue-900 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-lg shadow-lg border border-slate-200 p-8">
            <div className="flex justify-center mb-6">
              <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-3 rounded-lg text-white shadow-lg">
                <Calendar className="w-6 h-6" />
              </div>
            </div>

            <h1 className="text-2xl font-bold text-center text-slate-900 mb-2">Боба Кролик</h1>
            <p className="text-center text-slate-500 text-sm mb-6">График Работы</p>


            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Пароль сотрудника
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Введите пароль"
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50 text-slate-900"
                  autoFocus
                />
              </div>

              {passwordError && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg flex items-start gap-2 border border-red-200 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <p className="font-medium">{passwordError}</p>
                </div>
              )}

              <button
                type="submit"
                className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg font-semibold hover:from-blue-700 hover:to-blue-800 transition-all active:scale-95 shadow-md"
              >
                Войти
              </button>
            </form>

            <p className="text-center text-slate-400 text-xs mt-6">
              Только для сотрудников компании
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-slate-50 text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-100 px-6 py-4 shadow-xs flex justify-between items-center sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-2 rounded-lg text-white shadow-lg">
            <Calendar className="w-5 h-5" />
          </div>
          <div className="flex flex-col items-start">
            <h1 className="text-lg font-bold tracking-tight text-slate-900">Боба Кролик</h1>
            <p className="text-xs text-slate-500 font-medium">График Работы</p>
          </div>
        </div>
        <button
          onClick={fetchSheetData}
          disabled={isLoading}
          className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all active:scale-95 disabled:opacity-40"
          title="Обновить данные"
        >
          <RefreshCw className={`w-5 h-5 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="max-w-xl mx-auto p-4 pb-20">
        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-start gap-3 border border-red-200 animate-in fade-in slide-in-from-top-4">
            <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {isLoading && !rawData && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="relative w-12 h-12 mb-4">
              <div className="absolute inset-0 rounded-full border-4 border-slate-200"></div>
              <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"></div>
            </div>
            <p className="font-semibold text-slate-500">Загрузка данных...</p>
          </div>
        )}

        {!selectedUser && (!isLoading || rawData) && (
          <div className="space-y-8 animate-in fade-in duration-700 mt-6">
            <div className="text-center space-y-2">
              <h2 className="text-4xl font-black text-slate-800 tracking-tight">Кто работает?</h2>
              <p className="text-slate-400 font-medium text-lg">Найдите себя в общем списке</p>
            </div>

            <div className="bg-white rounded-lg shadow-md border border-slate-200 overflow-hidden">
              <div className="relative">
                <select
                  className="w-full p-4 pl-12 bg-transparent appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 text-base font-semibold text-slate-700 cursor-pointer"
                  onChange={(e) => setSelectedUser(e.target.value)}
                  value=""
                >
                  <option value="" disabled>Выберите имя...</option>
                  {employeeNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            <div className="flex justify-center gap-4 text-xs text-slate-500 font-medium">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Система актуальна
              </span>
              <span className="text-slate-300">•</span>
              <span>Всего смен: {parsedData.length}</span>
            </div>
          </div>
        )}

        {selectedUser && (
          <div className="space-y-6 animate-in slide-in-from-bottom-6 duration-500 mt-4">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-blue-600 font-semibold text-xs uppercase tracking-wide mb-1 block bg-blue-50 px-3 py-1 rounded w-fit">Профиль сотрудника</span>
                <h2 className="text-3xl font-bold text-slate-900 leading-none mt-2">{selectedUser}</h2>
              </div>
              <button
                onClick={() => setSelectedUser(null)}
                className="p-3 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 rounded-lg transition-all active:scale-95 shadow-sm"
                title="Вернуться"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="font-semibold text-slate-600 text-sm uppercase tracking-wide pl-1">Ближайшие смены</p>
              {userShifts.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-lg border border-slate-200">
                  <p className="text-slate-400 font-medium text-base">График пуст</p>
                </div>
              ) : (
                userShifts.map((shift, idx) => (
                  <div key={idx} className="bg-white p-5 rounded-lg shadow-sm border border-slate-200 flex flex-col gap-4 hover:shadow-md hover:border-blue-100 transition-all">
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 bg-blue-600 text-white rounded-lg flex flex-col items-center justify-center shadow-sm flex-shrink-0">
                        <span className="text-[9px] font-semibold uppercase opacity-75 leading-none mb-0.5">
                           {new Date(shift.date).toLocaleDateString('ru-RU', { month: 'short' })}
                        </span>
                        <span className="text-xl font-bold leading-none">
                          {new Date(shift.date).getDate()}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-0.5">
                          {new Date(shift.date).toLocaleDateString('ru-RU', { weekday: 'long' })}
                        </p>
                        <p className="text-base font-semibold text-slate-900">{shift.date}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                          <MapPin className="w-3.5 h-3.5" />
                          <span className="text-[9px] font-semibold uppercase tracking-wide">Филиал</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-800 truncate">{shift.store}</p>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                          <Clock className="w-3.5 h-3.5" />
                          <span className="text-[9px] font-semibold uppercase tracking-wide">Тип</span>
                        </div>
                        <p className={`text-sm font-semibold ${shift.time.toLowerCase().includes('ночь') ? 'text-blue-600' : 'text-amber-600'}`}>{shift.time}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <button
              onClick={() => { setSelectedUser(null); window.scrollTo(0,0); }}
              className="w-full p-4 text-slate-500 font-semibold text-sm uppercase tracking-wide hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors mt-2"
            >
              ← Выбрать другого сотрудника
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
