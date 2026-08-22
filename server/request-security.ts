export function isSameOriginMutation(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return false;

  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }

  if (originHeader !== requestOrigin) return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
}
