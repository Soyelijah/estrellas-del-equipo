export type AuthenticatedIdentity = {
  subjectId: string;
  email: string;
  displayName: string;
};

const SUBJECT_HEADER = "oai-authenticated-user-id";
const EMAIL_HEADER = "oai-authenticated-user-email";
const FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";

export function readAuthenticatedIdentity(
  requestHeaders: Headers,
): AuthenticatedIdentity | null {
  const subjectId = requestHeaders.get(SUBJECT_HEADER)?.trim();
  const email = requestHeaders.get(EMAIL_HEADER)?.trim().toLowerCase();

  if (!subjectId || !email) return null;

  const encodedFullName = requestHeaders.get(FULL_NAME_HEADER);
  const encoding = requestHeaders.get(FULL_NAME_ENCODING_HEADER);
  const fullName =
    encodedFullName && encoding === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)?.trim() || null
      : null;

  return {
    subjectId,
    email,
    displayName: fullName ?? email,
  };
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
