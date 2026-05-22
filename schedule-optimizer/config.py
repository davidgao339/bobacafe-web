SPREADSHEET_ID = '1MMKBimsoecrYKZD7JtrwRpVBrFfpxq0uJipmzL9DTWw'
SCHEDULE_SHEET_GID = 385579725

ALLOWED_EMAILS = [
    'davidgao734@gmail.com',
    'stefa.miva@gmail.com',
]

# Exact column headers from the Google Form responses sheet
COL_TS     = "Timestamp"
COL_MONTH  = "Месяц"
COL_NAME   = "Имя и Фамилия"
COL_MORN   = "Утренние смены (выбрать даты)"
COL_EVE    = "Вечерние смены (выбрать даты)"
COL_STORES = "В каких кафе вы можете работать "

SHIFTS = ["Утро", "Вечер"]
SHIFT_LABEL = {"Утро": "День", "Вечер": "Ночь"}

DEFAULT_STORE_WEIGHTS = {
    "Красная Площадь": 1.5,
    "Советов": 1.0,
    "Бон Пассаж": 1.0,
    "Краснодар Красная площадь": 1.5,
    "Краснодар Оз молл": 2.0,
    "Краснодар Галерея": 1.5,
    "Краснодар Володи Головатого": 1.0,
    "Черноморский": 0.5,
    "Грин Парк": 1.0,
}

MONTHS_RU = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

STRINGS: dict[str, dict] = {
    "en": {
        "app_title": "Schedule Optimizer — Boba Rabbit",
        "sign_in_desc": "Employee schedule optimization using CP-SAT.",
        "sign_in_btn": "Sign in with Google",
        "access_denied": "Access denied. Your account is not authorized.",
        "sign_out": "Sign out",
        "month_label": "Month",
        "solver_expander": "Solver Settings",
        "max_shifts_label": "Max shifts per employee",
        "time_limit_label": "Time limit (sec)",
        "output_sheet_label": "Output sheet name",
        "load_btn": "Load Data",
        "loading_msg": "Loading from Google Sheets...",
        "loaded_toast": "Data loaded!",
        "load_error": "Load error: {err}",
        "page_title": "Schedule Optimization",
        "no_data_info": "Click «Load Data» in the sidebar to get started.",
        "col_missing_error": "Column «{col}» not found. Check the sheet structure.",
        "metric_responses": "Responses this month",
        "metric_employees": "Employees",
        "metric_cafes": "Cafes",
        "no_month_warning": "No data for {month}. Select another month or reload.",
        "store_settings_header": "Cafe Settings",
        "store_settings_caption": "Adjust priority weight and staffing per cafe.",
        "col_store": "Cafe",
        "col_weight": "Weight",
        "col_morning": "Morning (ppl)",
        "col_evening": "Evening (ppl)",
        "weight_help": "Cafe priority in optimization (higher = more important to fill)",
        "morning_help": "Staff needed for morning shift",
        "evening_help": "Staff needed for evening shift",
        "run_btn": "Run Optimization",
        "solving_spinner": "Solving (up to {sec} sec)...",
        "opt_error": "Optimization error: {err}",
        "status_label": "Status",
        "metric_required": "Shifts required",
        "metric_filled": "Filled",
        "metric_missing": "Unfilled",
        "coverage_header": "Coverage by Day and Cafe",
        "date_col": "Date",
        "emp_dist_header": "Shift Distribution by Employee",
        "emp_col": "Employee",
        "shifts_col": "Shifts assigned",
        "deviation_col": "Deviation from avg",
        "save_btn": "Save to Google Sheets",
        "saving_spinner": "Saving...",
        "save_success": "Saved!",
        "save_error": "Save error: {err}",
        "download_btn": "Download CSV",
        "guide_expander": "How to use this tool",
        "guide_body": (
            "**Step 1 — Select month**\n"
            "Choose the month you want to schedule from the sidebar dropdown.\n\n"
            "**Step 2 — Load data**\n"
            "Click «Load Data» in the sidebar. This pulls employee availability responses from Google Sheets.\n\n"
            "**Step 3 — Review cafe settings**\n"
            "A settings table appears for each cafe found in the data:\n"
            "- **Weight** (0–5) — priority score. Higher weight = optimizer fills this cafe first. "
            "Use it to favour busy or understaffed locations.\n"
            "- **Morning / Evening (ppl)** — how many employees are required per shift per day at this cafe.\n\n"
            "**Step 4 — Run optimization**\n"
            "Click «Run Optimization». You will be asked to confirm your settings before the solver starts "
            "(default time limit: 30 sec).\n\n"
            "**Step 5 — Save results**\n"
            "Review the coverage heatmap and employee distribution, then save directly to Google Sheets or download as CSV."
        ),
        "confirm_title": "Confirm Settings Before Running",
        "confirm_intro": "Review your cafe settings below. The optimizer will use these values — adjust them in the table above if needed.",
        "confirm_weight_explain": "**Weight** — how strongly the optimizer prioritizes filling this cafe. A weight of 2.0 means the solver is twice as motivated to assign staff here compared to a cafe with weight 1.0. Useful for high-traffic or short-staffed locations.",
        "confirm_morning_explain": "**Morning (ppl)** — the number of employees the optimizer will try to assign to the morning shift each day at this cafe.",
        "confirm_evening_explain": "**Evening (ppl)** — the number of employees the optimizer will try to assign to the evening shift each day at this cafe.",
        "confirm_run": "Confirm & Run",
        "confirm_cancel": "Cancel",
        "months": ["January", "February", "March", "April", "May", "June",
                   "July", "August", "September", "October", "November", "December"],
    },
    "ru": {
        "app_title": "Оптимизация расписания — Боба Кролик",
        "sign_in_desc": "Оптимизация расписания сотрудников с помощью CP-SAT.",
        "sign_in_btn": "Войти через Google",
        "access_denied": "Доступ запрещён. Ваш аккаунт не авторизован.",
        "sign_out": "Выйти",
        "month_label": "Месяц",
        "solver_expander": "Настройки солвера",
        "max_shifts_label": "Макс. смен на сотрудника",
        "time_limit_label": "Время решения (сек)",
        "output_sheet_label": "Лист для записи в Sheets",
        "load_btn": "Загрузить данные",
        "loading_msg": "Загружаем из Google Sheets...",
        "loaded_toast": "Данные загружены!",
        "load_error": "Ошибка загрузки: {err}",
        "page_title": "Оптимизация расписания",
        "no_data_info": "Нажмите «Загрузить данные» в боковой панели для начала работы.",
        "col_missing_error": "Столбец «{col}» не найден. Проверьте структуру таблицы.",
        "metric_responses": "Ответов за месяц",
        "metric_employees": "Сотрудников",
        "metric_cafes": "Кафе",
        "no_month_warning": "Нет данных за {month}. Выберите другой месяц или перезагрузите данные.",
        "store_settings_header": "Настройки кафе",
        "store_settings_caption": "Измените вес приоритета и количество сотрудников на смену для каждого кафе.",
        "col_store": "Кафе",
        "col_weight": "Вес",
        "col_morning": "Утро (чел.)",
        "col_evening": "Вечер (чел.)",
        "weight_help": "Приоритет кафе в оптимизации (выше = важнее заполнить)",
        "morning_help": "Сколько сотрудников нужно на утреннюю смену",
        "evening_help": "Сколько сотрудников нужно на вечернюю смену",
        "run_btn": "Запустить оптимизацию",
        "solving_spinner": "Решаем задачу (до {sec} сек)...",
        "opt_error": "Ошибка оптимизации: {err}",
        "status_label": "Статус",
        "metric_required": "Требуется смен",
        "metric_filled": "Заполнено",
        "metric_missing": "Не заполнено",
        "coverage_header": "Покрытие по дням и кафе",
        "date_col": "Дата",
        "emp_dist_header": "Распределение смен по сотрудникам",
        "emp_col": "Сотрудник",
        "shifts_col": "Смен назначено",
        "deviation_col": "Отклонение от среднего",
        "save_btn": "Сохранить в Google Sheets",
        "saving_spinner": "Записываем...",
        "save_success": "Записано!",
        "save_error": "Ошибка записи: {err}",
        "download_btn": "Скачать CSV",
        "guide_expander": "Как пользоваться инструментом",
        "guide_body": (
            "**Шаг 1 — Выбрать месяц**\n"
            "Выберите нужный месяц в выпадающем списке в боковой панели.\n\n"
            "**Шаг 2 — Загрузить данные**\n"
            "Нажмите «Загрузить данные» в боковой панели. Данные о доступности сотрудников загружаются из Google Sheets.\n\n"
            "**Шаг 3 — Проверить настройки кафе**\n"
            "После загрузки появится таблица настроек для каждого кафе из данных:\n"
            "- **Вес** (0–5) — приоритет кафе. Чем выше, тем охотнее оптимизатор назначает сюда сотрудников. "
            "Используйте для загруженных или недоукомплектованных точек.\n"
            "- **Утро / Вечер (чел.)** — сколько сотрудников нужно на каждую смену в день в этом кафе.\n\n"
            "**Шаг 4 — Запустить оптимизацию**\n"
            "Нажмите «Запустить оптимизацию». Перед запуском система попросит подтвердить настройки "
            "(лимит по умолчанию: 30 сек).\n\n"
            "**Шаг 5 — Сохранить результат**\n"
            "Просмотрите карту покрытия и распределение смен, затем сохраните в Google Sheets или скачайте CSV."
        ),
        "confirm_title": "Подтвердите настройки перед запуском",
        "confirm_intro": "Проверьте параметры кафе ниже. Оптимизатор будет использовать именно эти значения — при необходимости скорректируйте их в таблице выше.",
        "confirm_weight_explain": "**Вес** — насколько охотно оптимизатор заполняет это кафе. Вес 2.0 означает, что оно заполняется вдвое охотнее кафе с весом 1.0. Полезно для загруженных или недоукомплектованных точек.",
        "confirm_morning_explain": "**Утро (чел.)** — сколько сотрудников оптимизатор старается поставить на утреннюю смену каждый день в этом кафе.",
        "confirm_evening_explain": "**Вечер (чел.)** — сколько сотрудников оптимизатор старается поставить на вечернюю смену каждый день в этом кафе.",
        "confirm_run": "Подтвердить и запустить",
        "confirm_cancel": "Отмена",
        "months": ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
                   "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
    },
}
