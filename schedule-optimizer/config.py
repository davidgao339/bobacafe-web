SPREADSHEET_ID = '1MMKBimsoecrYKZD7JtrwRpVBrFfpxq0uJipmzL9DTWw'

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
