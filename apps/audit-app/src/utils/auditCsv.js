// CSV parsing for bulk audit import (ported from stores-tabular ImportTab).
// Format: store, date, time, ingredient, unit, supplier, qty — one row per
// counted item; rows are grouped into audits by store+date. Delimiter
// auto-detected (, or ;), dates accept DD.MM.YYYY, an optional Russian label
// row after the header is skipped.

export function parseCSVLine(line, delim = ',') {
  const result = []
  let current = '', inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === delim && !inQuotes) {
      result.push(current); current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

const RUSSIAN_LABEL_CELLS = new Set(['кафе', 'дата', 'время', 'ингредиент', 'ед.измерения', 'количество'])

export function normalizeDate(raw) {
  // Accept DD.MM.YYYY in addition to YYYY-MM-DD
  const ddmmyyyy = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`
  return raw
}

// 24-hour H:mm or HH:mm → 'HH:mm', or null if invalid
export function normalizeTime(raw) {
  const m = raw.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

const csvEsc = v => /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v

// Template with one pre-filled row per ingredient (supplier-sorted, matching
// the stores-tabular template so existing files keep working).
export function buildTemplateCsv(ingredients, defaultStore, today) {
  const suppName = (ing) => ing.supplier_name || ''
  const rows = [
    ['store', 'date', 'time', 'ingredient', 'unit', 'supplier', 'qty'],
    ...[...ingredients]
      .sort((a, b) => {
        const sa = suppName(a), sb = suppName(b)
        if (sa !== sb) return sa.localeCompare(sb)
        return a.ingredient_name.localeCompare(b.ingredient_name)
      })
      .map(i => [defaultStore, today, '', i.ingredient_name, i.unit || '', suppName(i), '']),
  ]
  return rows.map(r => r.map(csvEsc).join(',')).join('\n')
}

// Match a store by RU name, EN name, or code (case-insensitive) — forgiving
// matching means files in circulation don't fail on naming variations.
function matchStore(raw, storeList) {
  const key = String(raw || '').trim().toLowerCase()
  if (!key) return null
  return storeList.find(s =>
    String(s.store_name || '').trim().toLowerCase() === key ||
    String(s.store_name_en || '').trim().toLowerCase() === key ||
    String(s.store_code || '').trim().toLowerCase() === key
  ) || null
}

// Parse a CSV file into audit groups. Returns:
// { audits: [{ store, storeId, storeCode, date, time, counts: {ingredientId: qty} }],
//   rowErrors: [{rowNum, msg}], unknownIngredients: [name] }
export function parseAuditCsv(text, { ingredients, stores }) {
  const clean = text.replace(/^﻿/, '')
  const lines = clean.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { audits: [], rowErrors: [], unknownIngredients: [] }

  // Auto-detect delimiter: whichever of , or ; appears more in the header line
  const delim = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ','

  const headers = parseCSVLine(lines[0], delim).map(h => h.trim().toLowerCase())
  const iStore = headers.indexOf('store')
  const iDate  = headers.indexOf('date')
  const iTime  = headers.indexOf('time')   // optional, 24h HH:mm
  const iIng   = headers.indexOf('ingredient')
  const iQty   = headers.indexOf('qty')
  if (iStore < 0 || iDate < 0 || iIng < 0 || iQty < 0)
    return { audits: [], rowErrors: [{ rowNum: 1, msg: 'bad header (need store, date, ingredient, qty)' }], unknownIngredients: [] }

  const ingByName = {}
  for (const i of ingredients) ingByName[String(i.ingredient_name).toLowerCase()] = i

  // Collect raw row errors and valid counts grouped by store+date
  const groups = {}   // key "storeId||date" -> { store, storeId, storeCode, date, time, counts }
  const rowErrors = []
  const unknownIngredients = new Set()

  // Determine first data row — skip a Russian label row if present
  const firstDataRow = (() => {
    const cells = parseCSVLine(lines[1], delim).map(c => c.trim().toLowerCase())
    const isLabel = cells.some(c => RUSSIAN_LABEL_CELLS.has(c))
    return isLabel ? 2 : 1
  })()

  for (let i = firstDataRow; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i], delim)
    if (cells.every(c => !c.trim())) continue
    const rowNum = i + 1
    const storeRaw = cells[iStore]?.trim() ?? ''
    const date    = normalizeDate(cells[iDate]?.trim() ?? '')
    const timeRaw = iTime >= 0 ? (cells[iTime]?.trim() ?? '') : ''
    const ingRaw  = cells[iIng]?.trim()   ?? ''
    const qtyRaw  = cells[iQty]?.trim()   ?? ''
    const errors = []

    const store = matchStore(storeRaw, stores)
    if (!store) errors.push(`unknown store "${storeRaw}"`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`invalid date "${cells[iDate]?.trim()}"`)
    const time = timeRaw ? normalizeTime(timeRaw) : null
    if (timeRaw && !time) errors.push(`invalid time "${timeRaw}" (use 24h HH:mm)`)
    const ing = ingByName[ingRaw.toLowerCase()]
    if (!ing) { if (ingRaw) unknownIngredients.add(ingRaw); continue }
    const qty = parseFloat(qtyRaw)
    if (qtyRaw && isNaN(qty)) errors.push(`invalid qty "${qtyRaw}"`)

    if (errors.length > 0) { rowErrors.push({ rowNum, msg: errors.join('; ') }); continue }
    if (!qtyRaw) continue  // blank qty = not counted, skip silently

    const key = `${store.store_id}||${date}`
    if (!groups[key]) groups[key] = { store: store.store_name, storeId: store.store_id, storeCode: store.store_code, date, time: null, counts: {} }
    if (time && !groups[key].time) groups[key].time = time
    groups[key].counts[ing.ingredient_id] = Math.max(0, qty)
  }

  return { audits: Object.values(groups), rowErrors, unknownIngredients: [...unknownIngredients].sort() }
}
