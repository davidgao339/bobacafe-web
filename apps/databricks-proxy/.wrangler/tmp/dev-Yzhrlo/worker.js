var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var DATABRICKS_TARGET = "https://dbc-d5bd17fc-eaf4.cloud.databricks.com/api/2.0/sql/statements";
var ORIGIN = "*";
var MAX_AUTO_BACKUPS = 5;
var MAX_MANUAL_BACKUPS = 10;
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }
    if (path === "/" || path === "") {
      return handleDatabricks(request);
    }
    if (path === "/backups" && request.method === "GET") {
      return handleListBackups(env);
    }
    if (path === "/backups" && request.method === "POST") {
      return handleSaveBackup(request, env);
    }
    const m = path.match(/^\/backups\/([^/]+)$/);
    if (m && request.method === "GET") {
      return handleGetBackup(m[1], env);
    }
    if (path === "/d1/query" && request.method === "POST") {
      return handleD1Query(request, env);
    }
    return new Response("Not found", { status: 404, headers: cors() });
  }
};
async function handleDatabricks(request) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors() });
  }
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer dapi")) {
    return new Response("Unauthorized", { status: 401, headers: cors() });
  }
  try {
    const resp = await fetch(DATABRICKS_TARGET, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": auth },
      body: request.body
    });
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { "Content-Type": "application/json", ...cors() }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors() }
    });
  }
}
__name(handleDatabricks, "handleDatabricks");
async function handleListBackups(env) {
  const result = await env.BACKUP_STORE.list({ prefix: "backup:" });
  const backups = result.keys.filter((k) => k.metadata).map((k) => k.metadata).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return json(backups);
}
__name(handleListBackups, "handleListBackups");
async function handleSaveBackup(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400, headers: cors() });
  }
  const id = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const savedAt = (/* @__PURE__ */ new Date()).toISOString();
  const meta = {
    id,
    savedAt,
    ingredientCount: body.config?.ingredients?.length ?? 0,
    auditCount: body.data?.audits?.length ?? 0,
    poCount: body.data?.purchaseOrders?.length ?? 0,
    isManual: body.isManual === true
  };
  await env.BACKUP_STORE.put(`backup:${id}`, JSON.stringify(body), { metadata: meta });
  if (env.DB) {
    env.DB.batch([]).catch(() => {
    });
    syncToD1(env.DB, body).catch((e) => console.error("D1 Sync Error:", e.message));
  }
  const result = await env.BACKUP_STORE.list({ prefix: "backup:" });
  const backups = result.keys.filter((k) => k.metadata).sort((a, b) => b.metadata.savedAt.localeCompare(a.metadata.savedAt));
  const autoBackups = backups.filter((k) => !k.metadata.isManual);
  const manualBackups = backups.filter((k) => k.metadata.isManual);
  if (autoBackups.length > MAX_AUTO_BACKUPS) {
    for (const old of autoBackups.slice(MAX_AUTO_BACKUPS)) {
      env.BACKUP_STORE.delete(old.name).catch(() => {
      });
    }
  }
  if (manualBackups.length > MAX_MANUAL_BACKUPS) {
    for (const old of manualBackups.slice(MAX_MANUAL_BACKUPS)) {
      env.BACKUP_STORE.delete(old.name).catch(() => {
      });
    }
  }
  return json({ id, savedAt });
}
__name(handleSaveBackup, "handleSaveBackup");
async function handleGetBackup(id, env) {
  const value = await env.BACKUP_STORE.get(`backup:${id}`);
  if (!value) return new Response("Not found", { status: 404, headers: cors() });
  return new Response(value, {
    status: 200,
    headers: { "Content-Type": "application/json", ...cors() }
  });
}
__name(handleGetBackup, "handleGetBackup");
async function handleD1Query(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400, headers: cors() });
  }
  if (!body.sql) return new Response("Missing sql", { status: 400, headers: cors() });
  try {
    const stmt = env.DB.prepare(body.sql).bind(...body.params || []);
    const results = await stmt.all();
    return json(results);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors() });
  }
}
__name(handleD1Query, "handleD1Query");
async function syncToD1(db, payload) {
  const { config, data } = payload;
  if (!config || !data) return;
  const statements = [];
  if (config.ingredients) {
    statements.push(db.prepare(`DELETE FROM ingredients`));
    for (const ing of config.ingredients) {
      statements.push(db.prepare(
        `INSERT INTO ingredients (id, name, unit, productType, supplierId) VALUES (?, ?, ?, ?, ?)`
      ).bind(ing.id, ing.name, ing.unit, ing.productType || null, ing.supplierId || null));
    }
  }
  if (config.recipes) {
    statements.push(db.prepare(`DELETE FROM recipes`));
    for (const [productName, mapping] of Object.entries(config.recipes)) {
      statements.push(db.prepare(
        `INSERT INTO recipes (product_name, ingredient_mapping) VALUES (?, ?)`
      ).bind(productName, JSON.stringify(mapping)));
    }
  }
  if (data.purchaseOrders) {
    statements.push(db.prepare(`DELETE FROM purchase_orders`));
    for (const po of data.purchaseOrders) {
      statements.push(db.prepare(
        `INSERT INTO purchase_orders (id, store, status, receivedAt, lines) VALUES (?, ?, ?, ?, ?)`
      ).bind(po.id, po.store, po.status, po.receivedAt || null, JSON.stringify(po.lines || [])));
    }
  }
  if (data.transactions) {
    statements.push(db.prepare(`DELETE FROM transactions`));
    for (const tx of data.transactions) {
      statements.push(db.prepare(
        `INSERT INTO transactions (id, store, date, type, ingredientId, quantity, poId, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(tx.id, tx.store, tx.date, tx.type, tx.ingredientId, tx.quantity, tx.poId || null, tx.reason || null, tx.timestamp || (/* @__PURE__ */ new Date()).toISOString()));
    }
  }
  if (data.audits) {
    statements.push(db.prepare(`DELETE FROM audits`));
    for (const audit of data.audits) {
      statements.push(db.prepare(
        `INSERT INTO audits (id, store, date, counts, timestamp) VALUES (?, ?, ?, ?, ?)`
      ).bind(audit.id, audit.store, audit.date, JSON.stringify(audit.counts || {}), audit.timestamp || (/* @__PURE__ */ new Date()).toISOString()));
    }
  }
  const BATCH_SIZE = 50;
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE));
  }
}
__name(syncToD1, "syncToD1");
function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...cors() }
  });
}
__name(json, "json");
function cors() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
__name(cors, "cors");

// C:/Users/david/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// C:/Users/david/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Vbzrco/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// C:/Users/david/AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Vbzrco/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
