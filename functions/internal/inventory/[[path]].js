export async function onRequest(context) {
  // Try to fetch the requested asset (e.g. JS, CSS, or exact path)
  const response = await context.env.ASSETS.fetch(context.request);
  
  // If found, return it directly
  if (response.status !== 404) {
    return response;
  }
  
  // If it's a 404 (e.g. a deep link), rewrite to the app's index.html
  const url = new URL(context.request.url);
  url.pathname = '/internal/inventory/index.html';
  return context.env.ASSETS.fetch(new Request(url, context.request));
}
