const API_BASE = import.meta.env.VITE_API_BASE || '';

function headers(apiKey) {
  return { 'X-Org-Api-Key': apiKey };
}

export async function fetchOverview(apiKey, from, to) {
  const q = new URLSearchParams({ from: String(from), to: String(to) });
  const res = await fetch(`${API_BASE}/v1/team/overview?${q}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchMembers(apiKey, from, to) {
  const q = new URLSearchParams({ from: String(from), to: String(to) });
  const res = await fetch(`${API_BASE}/v1/team/members?${q}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchSessions(apiKey, from, to, userId, limit, offset) {
  const q = new URLSearchParams({ from: String(from), to: String(to) });
  if (userId) q.set('user_id', userId);
  if (limit != null) q.set('limit', String(limit));
  if (offset != null) q.set('offset', String(offset));
  const res = await fetch(`${API_BASE}/v1/team/sessions?${q}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchSessionDetail(apiKey, id) {
  const res = await fetch(`${API_BASE}/v1/team/sessions/${encodeURIComponent(id)}`, {
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
