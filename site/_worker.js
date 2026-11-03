export default {
  async fetch(request, env) {
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404) {
      const url = new URL(request.url);
      const path = url.pathname;

      const apps = [
        { prefix: "/internal/audit/",     index: "/internal/audit/index.html" },
        { prefix: "/internal/inventory/", index: "/internal/inventory/index.html" },
        { prefix: "/internal/warehouse/", index: "/internal/warehouse/index.html" },
        { prefix: "/internal/schedule/",  index: "/internal/schedule/index.html" },
      ];

      for (const app of apps) {
        if (path.startsWith(app.prefix)) {
          const rewritten = new URL(request.url);
          rewritten.pathname = app.index;
          return env.ASSETS.fetch(new Request(rewritten, request));
        }
      }
    }

    return response;
  }
};
