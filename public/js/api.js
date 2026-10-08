// Tiny API client + realtime connection.
export const state = { user: null, token: localStorage.getItem('hm_token'), meta: null };

export function setSession(token, user) {
  state.token = token; state.user = user;
  if (token) localStorage.setItem('hm_token', token); else localStorage.removeItem('hm_token');
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch('/api' + path, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { setSession(null, null); location.hash = '#/login'; }
  if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.data = data; e.status = res.status; throw e; }
  return data;
}

let es;
export function connectEvents(onRefresh, onNotification) {
  if (es) es.close();
  if (!state.token) return;
  es = new EventSource('/api/events?token=' + encodeURIComponent(state.token));
  es.addEventListener('refresh', e => onRefresh(JSON.parse(e.data)));
  es.addEventListener('notification', e => onNotification(JSON.parse(e.data)));
}
export function disconnectEvents() { if (es) es.close(); es = null; }
export const live = () => !!es;
export const fileUrl = name => `/api/files/${name}?token=${encodeURIComponent(state.token)}`;
export const qrUrl = id => `/api/machines/${id}/qr?token=${encodeURIComponent(state.token)}`;
