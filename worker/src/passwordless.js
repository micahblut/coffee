const API_URL = "https://v4.passwordless.dev";

/**
 * @param {string} apiSecret
 * @param {{ userId: string, username: string }} params
 * @returns {Promise<string>} a short-lived registration token for the client SDK
 */
export async function createRegisterToken(apiSecret, { userId, username }) {
  const response = await fetch(`${API_URL}/register/token`, {
    method: "POST",
    headers: { ApiSecret: apiSecret, "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      username,
      discoverable: true,
      userVerification: "preferred",
    }),
  });
  if (!response.ok) {
    throw new Error(`Passwordless register/token failed: ${response.status}`);
  }
  const data = await response.json();
  return data.token;
}

/**
 * @param {string} apiSecret
 * @param {string} token
 * @returns {Promise<{ userId: string } | null>} null if verification failed
 */
export async function verifySigninToken(apiSecret, token) {
  const response = await fetch(`${API_URL}/signin/verify`, {
    method: "POST",
    headers: { ApiSecret: apiSecret, "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) return null;

  const data = await response.json();
  return data.success ? data : null;
}

/**
 * @param {string} apiSecret
 * @param {string} userId
 * @returns {Promise<unknown[]>}
 */
export async function listCredentials(apiSecret, userId) {
  const response = await fetch(
    `${API_URL}/credentials/list?userId=${encodeURIComponent(userId)}`,
    { headers: { ApiSecret: apiSecret } },
  );
  if (!response.ok) return [];
  const data = await response.json();
  return data.values;
}
