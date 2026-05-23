export function authRequest(endpoint: string, payload: { phoneOrEmail: string; password: string }) {
  return fetch('http://localhost:3000/api/auth/' + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
