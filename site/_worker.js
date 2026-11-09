export default {
  async fetch(request, env) {
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404) {
      const url = new URL(request.url);
      const path = url.pathname;

      // SPA fallback for ANY /internal/<app>/... route: serve that app's
      // index.html so client-side routes (e.g. /internal/stores-tabular/ledger)
      // never 404. New apps are covered automatically — no list to maintain.
      const m = path.match(/^\/internal\/([^/]+)\/.+$/);
      if (m) {
        const rewritten = new URL(request.url);
        rewritten.pathname = `/internal/${m[1]}/index.html`;
        const index = await env.ASSETS.fetch(new Request(rewritten, request));
        if (index.status !== 404) return index;
      }
    }

    return response;
  }
};
