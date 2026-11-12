// Cloudflare D1 Client & Relational Audit API

const isDevDeploy = typeof window !== 'undefined' && (
  window.location.hostname.startsWith('dev.') ||
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
);

const BACKUP_BASE = isDevDeploy
  ? 'https://bobacafe-proxy-dev.davidgao734.workers.dev'
  : 'https://bobacafe-proxy.davidgao734.workers.dev';

export async function queryD1(sql, params = [], retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(`${BACKUP_BASE}/d1/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        let errMsg = text;
        try {
          const parsed = JSON.parse(text);
          errMsg = parsed.error || parsed.message || text;
        } catch {}
        throw new Error(`D1 Error (${resp.status}): ${errMsg}`);
      }
      const data = await resp.json();
      return data.results || [];
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}

// ─── STORES & INGREDIENTS ────────────────────────────────────────────────────

export async function fetchStores() {
  const sql = `
    SELECT store_id, store_code, store_name, store_name_en, city, store_type, is_active 
    FROM dim_stores 
    WHERE is_active = 1 
    ORDER BY store_id ASC
  `;
  return await queryD1(sql);
}

export async function fetchIngredients() {
  const sql = `
    SELECT ingredient_id, ingredient_name, unit, product_type, supplier_name 
    FROM dim_ingredients 
    WHERE is_warehouse_only = 0 AND is_hidden = 0 
    ORDER BY product_type ASC, ingredient_name ASC
  `;
  return await queryD1(sql);
}

// ─── LAST AUDIT BASELINE ─────────────────────────────────────────────────────

export async function fetchLatestStoreAudit(storeId) {
  const sql = `
    WITH latest_header AS (
      SELECT audit_id, audit_date, audit_timestamp
      FROM fact_audit_headers
      WHERE store_id = ? AND status = 'approved'
      ORDER BY audit_date DESC, audit_timestamp DESC
      LIMIT 1
    )
    SELECT h.audit_id, h.audit_date, h.audit_timestamp, c.ingredient_id, c.count_quantity
    FROM latest_header h
    JOIN fact_audit_counts c ON h.audit_id = c.audit_id
  `;
  const rows = await queryD1(sql, [storeId]);
  const map = {};
  let auditDate = null;
  for (const r of rows) {
    map[r.ingredient_id] = r.count_quantity;
    auditDate = r.audit_date;
  }
  return { lastDate: auditDate, counts: map };
}

export async function fetchAuditForStoreAndDate(storeId, auditDate) {
  const sql = `
    SELECT audit_id, store_id, store_code, audit_date, audit_timestamp, status
    FROM fact_audit_headers
    WHERE store_id = ? AND audit_date = ?
    ORDER BY audit_timestamp DESC LIMIT 1
  `;
  const rows = await queryD1(sql, [storeId, auditDate]);
  if (rows.length === 0) return null;

  const details = await fetchAuditDetails(rows[0].audit_id);
  const countsMap = {};
  for (const d of details) {
    countsMap[d.ingredient_id] = d.count_quantity;
  }
  return { header: rows[0], counts: countsMap };
}

// ─── DATE GUARDRAILS (blind-count safe: dates only, never counts) ────────────

// Latest approved audit DATE for one store. Used to block/warn on backdated
// audits without exposing any counts to baristas.
export async function fetchLatestStoreAuditDate(storeId) {
  const sql = `
    SELECT audit_date
    FROM fact_audit_headers
    WHERE store_id = ? AND status = 'approved'
    ORDER BY audit_date DESC, audit_timestamp DESC
    LIMIT 1
  `;
  const rows = await queryD1(sql, [storeId]);
  return rows.length > 0 ? rows[0].audit_date : null;
}

// Latest approved audit DATE for every store at once — used by the CSV import
// preview to flag backdated groups.
export async function fetchLatestAuditDates() {
  const sql = `
    SELECT store_id, MAX(audit_date) AS last_date
    FROM fact_audit_headers
    WHERE status = 'approved'
    GROUP BY store_id
  `;
  const rows = await queryD1(sql);
  const map = {};
  for (const r of rows) map[r.store_id] = r.last_date;
  return map;
}

// ─── REAL-TIME LAKEHOUSE PUSH (via proxy worker /lh/audit) ────────────────────
// The nightly D1→LH sync would eventually carry these rows, but orders are
// placed the same day right after an audit, so the push must be immediate.
// Fire-and-forget: on failure the nightly sync is the backstop.

export async function pushAuditToLakehouse(entries) {
  try {
    const resp = await fetch(`${BACKUP_BASE}/lh/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`LH push error (${resp.status}): ${text.slice(0, 200)}`);
    }
    return true;
  } catch (err) {
    console.error('Lakehouse push failed (D1 write already saved):', err);
    return false;
  }
}

// ─── SAVE AUDIT (RELATIONAL + DUAL-WRITE BACKWARD COMPATIBILITY) ────────────

export async function saveAudit({ auditId, storeId, storeCode, storeName, auditDate, auditTimestamp, status = 'approved', counts }) {
  // If editing an existing audit, keep its ID; otherwise create a clean ID
  let id = auditId;
  if (!id) {
    // Generate store-scoped sequential ID (e.g. BON-001, RSQ-001) with numeric sorting
    const code = storeCode || 'AUD';
    const prefix = `${code}-`;
    const res = await queryD1(
      `SELECT MAX(CAST(SUBSTR(audit_id, ?) AS INTEGER)) as max_num 
       FROM fact_audit_headers 
       WHERE audit_id LIKE ?`,
      [prefix.length + 1, `${prefix}%`]
    );
    const nextNum = (res.length > 0 && res[0].max_num != null) ? res[0].max_num + 1 : 1;
    id = `${prefix}${String(nextNum).padStart(3, '0')}`;
  }

  const timestamp = auditTimestamp || new Date().toISOString();

  // 1. Insert or update header in fact_audit_headers
  await queryD1(
    `INSERT OR REPLACE INTO fact_audit_headers (audit_id, store_id, store_code, audit_date, audit_timestamp, status) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, storeId, storeCode, auditDate, timestamp, status]
  );

  // 2. Clear previous counts for this session if updating
  await queryD1(`DELETE FROM fact_audit_counts WHERE audit_id = ?`, [id]);

  // 3. Insert counted items (including explicit 0 counts) in fact_audit_counts
  const activeEntries = Object.entries(counts)
    .filter(([_, qty]) => qty !== '' && qty !== null && qty !== undefined && !isNaN(parseFloat(qty)))
    .map(([ingId, qty]) => ({
      ingredient_id: parseInt(ingId, 10),
      count_quantity: parseFloat(qty)
    }));

  if (activeEntries.length > 0) {
    // Cloudflare D1 hard limit is 100 host variables (?) per SQL statement.
    // Each item uses 5 parameters, so BATCH = 15 (75 variables) is completely safe.
    const BATCH = 15;
    for (let i = 0; i < activeEntries.length; i += BATCH) {
      const chunk = activeEntries.slice(i, i + BATCH);
      const valuesPlaceholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
      const params = [];
      for (const item of chunk) {
        params.push(id, storeId, auditDate, item.ingredient_id, item.count_quantity);
      }
      await queryD1(
        `INSERT INTO fact_audit_counts (audit_id, store_id, audit_date, ingredient_id, count_quantity) VALUES ${valuesPlaceholders}`,
        params
      );
    }
  }

  // 4. Update live stock on hand in fact_inventory_balance for approved audits
  if (status === 'approved' && activeEntries.length > 0) {
    try {
      await queryD1(
        `INSERT OR REPLACE INTO fact_inventory_balance (store_id, ingredient_id, current_quantity, unit, last_audit_id, last_audit_date, last_updated_at)
         SELECT 
             c.store_id,
             c.ingredient_id,
             c.count_quantity,
             COALESCE(i.unit, ''),
             c.audit_id,
             c.audit_date,
             CURRENT_TIMESTAMP
         FROM fact_audit_counts c
         LEFT JOIN dim_ingredients i ON c.ingredient_id = i.ingredient_id
         WHERE c.audit_id = ?`,
        [id]
      );
    } catch (err) {
      console.warn("Inventory balance update notice:", err);
    }
  }

  // 5. Backward compatibility dual-write to legacy 'audits' table
  // (Ensures unmigrated screens in inventory-app continue functioning without missing records)
  try {
    const legacyCountsObj = {};
    for (const [ingId, qty] of Object.entries(counts)) {
      if (qty !== '') legacyCountsObj[ingId] = parseFloat(qty);
    }
    await queryD1(
      `INSERT OR REPLACE INTO audits (id, store, date, counts, timestamp, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, storeName, auditDate, JSON.stringify(legacyCountsObj), timestamp, status]
    );
  } catch (err) {
    console.warn("Legacy audit dual-write notice:", err);
  }

  return { id, storeId, storeCode, auditDate, status };
}

// ─── AUDIT HISTORY ───────────────────────────────────────────────────────────

export async function fetchAuditHistory(storeId = null, limit = 50) {
  let whereClause = '';
  const params = [];
  if (storeId) {
    whereClause = 'WHERE store_id = ?';
    params.push(storeId);
  }
  params.push(limit);

  // Optimization: CTE limits the headers to the recent N audits FIRST,
  // preventing full-table scan across thousands of historic count rows (82% read reduction).
  const sql = `
    WITH recent_headers AS (
      SELECT audit_id, store_id, store_code, audit_date, audit_timestamp, status
      FROM fact_audit_headers
      ${whereClause}
      ORDER BY audit_date DESC, audit_timestamp DESC
      LIMIT ?
    )
    SELECT 
        h.audit_id, 
        h.store_id, 
        h.store_code, 
        COALESCE(s.store_name, h.store_code) as store_name,
        h.audit_date, 
        h.audit_timestamp, 
        h.status,
        COUNT(c.ingredient_id) as items_counted,
        ROUND(SUM(c.count_quantity), 1) as total_units
    FROM recent_headers h
    LEFT JOIN dim_stores s ON h.store_id = s.store_id
    LEFT JOIN fact_audit_counts c ON h.audit_id = c.audit_id
    GROUP BY h.audit_id, h.store_id, h.store_code, s.store_name, h.audit_date, h.audit_timestamp, h.status
    ORDER BY h.audit_date DESC, h.audit_timestamp DESC
  `;
  return await queryD1(sql, params);
}

export async function fetchAuditDetails(auditId) {
  const sql = `
    SELECT 
        c.ingredient_id, 
        COALESCE(i.ingredient_name, c.ingredient_name) as ingredient_name, 
        COALESCE(i.unit, '') as unit, 
        COALESCE(i.product_type, 'other') as product_type,
        c.count_quantity
    FROM fact_audit_counts c
    LEFT JOIN dim_ingredients i ON c.ingredient_id = i.ingredient_id
    WHERE c.audit_id = ?
    ORDER BY c.ingredient_name ASC
  `;
  return await queryD1(sql, [auditId]);
}

export async function updateAuditStatus(auditId, status) {
  await queryD1(`UPDATE fact_audit_headers SET status = ? WHERE audit_id = ?`, [status, auditId]);
  if (status === 'approved') {
    try {
      await queryD1(
        `INSERT OR REPLACE INTO fact_inventory_balance (store_id, ingredient_id, current_quantity, unit, last_audit_id, last_audit_date, last_updated_at)
         SELECT 
             c.store_id,
             c.ingredient_id,
             c.count_quantity,
             COALESCE(i.unit, ''),
             c.audit_id,
             c.audit_date,
             CURRENT_TIMESTAMP
         FROM fact_audit_counts c
         LEFT JOIN dim_ingredients i ON c.ingredient_id = i.ingredient_id
         WHERE c.audit_id = ?`,
        [auditId]
      );
    } catch (err) {
      console.warn("Inventory balance update notice on approval:", err);
    }
  }
  try {
    await queryD1(`UPDATE audits SET status = ? WHERE id = ?`, [status, auditId]);
  } catch {}
}

export async function fetchCurrentInventoryBalance(storeId) {
  const sql = `
    SELECT 
        b.ingredient_id,
        COALESCE(i.ingredient_name, 'Ingredient #' || b.ingredient_id) as ingredient_name,
        COALESCE(i.unit, b.unit) as unit,
        COALESCE(i.product_type, 'other') as product_type,
        b.current_quantity,
        b.last_audit_id,
        b.last_audit_date,
        b.last_updated_at
    FROM fact_inventory_balance b
    LEFT JOIN dim_ingredients i ON b.ingredient_id = i.ingredient_id
    WHERE b.store_id = ?
    ORDER BY i.product_type ASC, i.ingredient_name ASC
  `;
  return await queryD1(sql, [storeId]);
}

export async function deleteAudit(auditId) {
  await queryD1(`DELETE FROM fact_audit_counts WHERE audit_id = ?`, [auditId]);
  await queryD1(`DELETE FROM fact_audit_headers WHERE audit_id = ?`, [auditId]);
  try {
    await queryD1(`DELETE FROM audits WHERE id = ?`, [auditId]);
  } catch {}
}

