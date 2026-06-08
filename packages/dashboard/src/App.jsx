import React, { useCallback, useEffect, useState } from 'react';
import { fetchOverview, fetchMembers, fetchSessions, fetchSessionDetail } from './api';
import KpiCard from './components/KpiCard';
import SessionPanel from './components/SessionPanel';

const DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 50;
const RANGE_OPTIONS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('org_api_key') || '');
  const [rangeDays, setRangeDays] = useState(7);
  const [overview, setOverview] = useState(null);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [selectedMember, setSelectedMember] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsHasMore, setSessionsHasMore] = useState(false);
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false);

  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionDetail, setSessionDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    async (days = rangeDays) => {
      if (!apiKey) return;
      setLoading(true);
      setError('');
      try {
        localStorage.setItem('org_api_key', apiKey);
        const from = Date.now() - days * DAY;
        const [ov, mem] = await Promise.all([
          fetchOverview(apiKey, from, Date.now()),
          fetchMembers(apiKey, from, Date.now()),
        ]);
        setOverview(ov);
        setMembers(mem.members || []);
        setSelectedMember(null);
        setSessions([]);
        setSessionsHasMore(false);
        setSelectedSessionId(null);
        setSessionDetail(null);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [apiKey, rangeDays]
  );

  useEffect(() => {
    if (apiKey) load();
  }, []);

  const changeRange = useCallback(
    (days) => {
      setRangeDays(days);
      load(days);
    },
    [load]
  );

  const openMember = useCallback(
    async (member) => {
      setSelectedMember(member);
      setSelectedSessionId(null);
      setSessionDetail(null);
      setSessionsLoading(true);
      setSessionsHasMore(false);
      setError('');
      try {
        const from = Date.now() - rangeDays * DAY;
        const res = await fetchSessions(apiKey, from, Date.now(), member.user_id, PAGE_SIZE, 0);
        const rows = res.sessions || [];
        setSessions(rows);
        setSessionsHasMore(rows.length === PAGE_SIZE);
      } catch (e) {
        setError(e.message);
        setSessions([]);
      } finally {
        setSessionsLoading(false);
      }
    },
    [apiKey, rangeDays]
  );

  const loadMoreSessions = useCallback(async () => {
    if (!selectedMember) return;
    setSessionsLoadingMore(true);
    setError('');
    try {
      const from = Date.now() - rangeDays * DAY;
      const res = await fetchSessions(
        apiKey,
        from,
        Date.now(),
        selectedMember.user_id,
        PAGE_SIZE,
        sessions.length
      );
      const rows = res.sessions || [];
      setSessions((prev) => [...prev, ...rows]);
      setSessionsHasMore(rows.length === PAGE_SIZE);
    } catch (e) {
      setError(e.message);
    } finally {
      setSessionsLoadingMore(false);
    }
  }, [apiKey, rangeDays, selectedMember, sessions.length]);

  const openSession = useCallback(
    async (session) => {
      setSelectedSessionId(session.session_id);
      setSessionDetail(null);
      setDetailLoading(true);
      try {
        const res = await fetchSessionDetail(apiKey, session.session_id);
        setSessionDetail(res);
      } catch (e) {
        setError(e.message);
      } finally {
        setDetailLoading(false);
      }
    },
    [apiKey]
  );

  const closeMember = () => {
    setSelectedMember(null);
    setSessions([]);
    setSessionsHasMore(false);
    setSelectedSessionId(null);
    setSessionDetail(null);
  };

  const closeSession = () => {
    setSelectedSessionId(null);
    setSessionDetail(null);
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Team AI Usage</h1>
        <p style={{ color: '#8b9cb3', marginTop: 8 }}>Last {rangeDays} days — self-hosted dashboard</p>
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
        <label>
          <span style={{ display: 'block', fontSize: 12, color: '#8b9cb3', marginBottom: 4 }}>
            Date range
          </span>
          <select
            value={rangeDays}
            onChange={(e) => changeRange(Number(e.target.value))}
            disabled={loading || !apiKey}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #2a3544',
              background: '#1a2332',
              color: '#e7ecf3',
              cursor: 'pointer',
            }}
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => load()}
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
        <section style={{ marginBottom: 32 }}>
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
              {members.map((m) => {
                const active = selectedMember?.user_id === m.user_id;
                return (
                  <tr
                    key={m.user_id}
                    onClick={() => openMember(m)}
                    style={{
                      cursor: 'pointer',
                      background: active ? '#1a2332' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836', color: '#3d7eff' }}>
                      {m.email}
                    </td>
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
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {selectedMember && (
        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: 18, margin: 0 }}>Sessions — {selectedMember.email}</h2>
            <button
              type="button"
              onClick={closeMember}
              style={{
                border: '1px solid #2a3544',
                background: 'transparent',
                color: '#8b9cb3',
                borderRadius: 8,
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Close
            </button>
          </div>

          {sessionsLoading && <p style={{ color: '#8b9cb3' }}>Loading sessions…</p>}

          {!sessionsLoading && sessions.length === 0 && (
            <p style={{ color: '#8b9cb3' }}>No sessions in the last {rangeDays} days.</p>
          )}

          {!sessionsLoading && sessions.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#8b9cb3' }}>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>Session</th>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>Source</th>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>Messages</th>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>Tokens in</th>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #2a3544' }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const active = selectedSessionId === s.session_id;
                  return (
                    <tr
                      key={s.session_id}
                      onClick={() => openSession(s)}
                      style={{
                        cursor: 'pointer',
                        background: active ? '#1a2332' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836', color: '#3d7eff' }}>
                        {s.name || s.session_id}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836' }}>{s.source}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836' }}>
                        {s.total_messages ?? s.message_count ?? 0}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836' }}>
                        {Number(s.total_input_tokens || 0).toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #1e2836' }}>
                        {s.last_updated_at
                          ? new Date(Number(s.last_updated_at)).toLocaleString()
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {!sessionsLoading && sessionsHasMore && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={loadMoreSessions}
                disabled={sessionsLoadingMore}
                style={{
                  border: '1px solid #2a3544',
                  background: '#1a2332',
                  color: '#e7ecf3',
                  borderRadius: 8,
                  padding: '8px 16px',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {sessionsLoadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </section>
      )}

      {selectedSessionId && (
        <SessionPanel data={sessionDetail} loading={detailLoading} onClose={closeSession} />
      )}
    </div>
  );
}
