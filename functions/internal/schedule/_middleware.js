export const onRequest = async (context) => {
  const response = await context.next();
  if (response.status === 404) {
    const url = new URL(context.request.url);
    url.pathname = '/internal/schedule/index.html';
    return context.env.ASSETS.fetch(new Request(url, context.request));
  }
  return response;
};
