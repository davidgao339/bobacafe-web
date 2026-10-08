export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const apps = [
      { prefix: "/internal/inventory/" },
      { prefix: "/internal/warehouse/" },
      { prefix: "/internal/schedule/" },
    ];

    for (const app of apps) {
      if (path.startsWith(app.prefix)) {
        const lastSegment = path.split("/").pop();
        if (lastSegment && lastSegment.includes(".")) {
          return env.ASSETS.fetch(request);
        }
        const rewritten = new URL(request.url);
        rewritten.pathname = app.prefix;
        return env.ASSETS.fetch(new Request(rewritten, request));
      }
    }

    return env.ASSETS.fetch(request);
  }
};
