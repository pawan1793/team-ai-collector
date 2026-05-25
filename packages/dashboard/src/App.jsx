import React, { useCallback, useEffect, useState } from 'react';
import { fetchOverview, fetchMembers } from './api';
import KpiCard from './components/KpiCard';

const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('org_api_key') || '');
  const [overview, setOverview] = useState(null);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    setError('');
    try {
      localStorage.setItem('org_api_key', apiKey);
      const [ov, mem] = await Promise.all([
        fetchOverview(apiKey, sevenDaysAgo, Date.now()),
        fetchMembers(apiKey, sevenDaysAgo, Date.now()),
      ]);
      setOverview(ov);
      setMembers(mem.members || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (apiKey) load();
  }, []);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Team AI Usage</h1>
        <p style={{ color: '#8b9cb3', marginTop: 8 }}>Last 7 days — self-hosted dashboard</p>
      </header>

      <section
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 24,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <label style={{ flex: 1, minWidth: 280 }}>
          <span style={{ display: 'block', fontSize: 12, color: '#8b9cb3', marginBottom: 4 }}>
            Organization API key
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="org_…"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #2a3544',
              background: '#1a2332',
              color: '#e7ecf3',
            }}
          />
        </label>
        <button
          type="button"
          onClick={load}
          disabled={loading || !apiKey}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: '#3d7eff',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {loading ? 'Loading…' : 'Load'}
        </button>
      </section>

      {error && (
        <p style={{ color: '#ff6b6b', marginBottom: 16 }}>{error}</p>
      )}

      {overview && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 16,
            marginBottom: 32,
          }}
        >
          <KpiCard label="Active members" value={overview.active_members ?? 0} />
          <KpiCard label="Sessions" value={overview.total_sessions ?? 0} />
          <KpiCard label="Messages" value={overview.total_messages ?? 0} />
          <KpiCard
            label="Input tokens"
            value={Number(overview.total_input_tokens || 0).toLocaleString()}
          />
          <KpiCard
            label="Output tokens"
            value={Number(overview.total_output_tokens || 0).toLocaleString()}
          />
        </div>
      )}

      {members.length > 0 && (
        <section>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Members</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#8b9cb3' }}>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>Email</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>Sessions</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>Messages</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>Tokens in</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>Last active</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836' }}>{m.email}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836' }}>{m.sessions}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836' }}>{m.messages}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836' }}>
                    {Number(m.input_tokens || 0).toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836' }}>
                    {m.last_active_at
                      ? new Date(Number(m.last_active_at)).toLocaleString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
