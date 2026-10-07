export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const apps = [
      { prefix: "/internal/inventory/", index: "/internal/inventory/index.html" },
      { prefix: "/internal/warehouse/", index: "/internal/warehouse/index.html" },
      { prefix: "/internal/schedule/",  index: "/internal/schedule/index.html" },
    ];

    for (const app of apps) {
      if (path.startsWith(app.prefix)) {
        const lastSegment = path.split("/").pop();
        if (lastSegment && lastSegment.includes(".")) {
          return env.ASSETS.fetch(request);
        }
        const rewritten = new URL(request.url);
        rewritten.pathname = app.index;
        return env.ASSETS.fetch(new Request(rewritten, request));
      }
    }

    return env.ASSETS.fetch(request);
  }
};
