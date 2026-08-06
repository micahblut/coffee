const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * @param {string} token
 * @param {string} secretKey
 * @param {string | null} remoteIp
 * @returns {Promise<boolean>}
 */
export async function verifyTurnstile(token, secretKey, remoteIp) {
  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return false;

  const data = await response.json();
  return data.success === true;
}
