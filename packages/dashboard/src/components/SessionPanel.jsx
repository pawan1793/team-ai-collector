import { estimateSessionCost, formatUsd } from '../pricing';

const ROLE_COLORS = {
  user: '#3d7eff',
  assistant: '#36c98f',
  system: '#8b9cb3',
  tool: '#d4a13d',
};

function SpendBanner({ session }) {
  const cost = estimateSessionCost(session);

  return (
    <div
      style={{
        marginBottom: 16,
        padding: '14px 16px',
        background: '#16241c',
        border: '1px solid #2c4536',
        borderRadius: 10,
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 11, color: '#8b9cb3', marginBottom: 2 }}>
          Estimated spend{cost?.estimated ? ' (approx.)' : ''}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#36c98f' }}>
          {cost ? `${cost.estimated ? '~' : ''}${formatUsd(cost.usd)}` : '—'}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#8b9cb3', textAlign: 'right', maxWidth: 220 }}>
        {cost ? (
          <>
            <div>{cost.tier.label} rates</div>
            {cost.unpriced.length > 0 && (
              <div style={{ marginTop: 2 }}>
                Excludes unpriced: {cost.unpriced.join(', ')}
              </div>
            )}
          </>
        ) : (
          'No recognized model — pricing unavailable'
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#8b9cb3', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export default function SessionPanel({ data, loading, onClose }) {
  const session = data?.session;
  const messages = data?.messages || [];

  return (
    <aside
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(480px, 100%)',
        background: '#141b27',
        borderLeft: '1px solid #2a3544',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid #2a3544',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>Session details</h2>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            color: '#8b9cb3',
            fontSize: 22,
            cursor: 'pointer',
            lineHeight: 1,
          }}
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
        {loading && <p style={{ color: '#8b9cb3' }}>Loading…</p>}

        {!loading && session && (
          <>
            <div style={{ marginBottom: 4, fontSize: 15, fontWeight: 600 }}>
              {session.name || session.session_id}
            </div>
            <div style={{ fontSize: 12, color: '#8b9cb3', marginBottom: 16, wordBreak: 'break-all' }}>
              {session.project_path || session.session_id}
            </div>

            <SpendBanner session={session} />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 12,
                marginBottom: 20,
                padding: 14,
                background: '#1a2332',
                border: '1px solid #2a3544',
                borderRadius: 10,
              }}
            >
              <Stat label="Source" value={session.source || '—'} />
              <Stat label="Mode" value={session.mode || '—'} />
              <Stat label="Messages" value={session.total_messages ?? session.message_count ?? 0} />
              <Stat
                label="Tokens in"
                value={Number(session.total_input_tokens || 0).toLocaleString()}
              />
              <Stat
                label="Tokens out"
                value={Number(session.total_output_tokens || 0).toLocaleString()}
              />
              <Stat
                label="Last updated"
                value={
                  session.last_updated_at
                    ? new Date(Number(session.last_updated_at)).toLocaleString()
                    : '—'
                }
              />
            </div>

            <h3 style={{ fontSize: 13, color: '#8b9cb3', margin: '0 0 12px' }}>
              Messages ({messages.length})
            </h3>

            {messages.length === 0 && (
              <p style={{ color: '#8b9cb3', fontSize: 13 }}>
                No message content available (may be restricted by org policy).
              </p>
            )}

            {messages.map((m) => (
              <div
                key={m.seq}
                style={{
                  marginBottom: 12,
                  padding: 12,
                  background: '#1a2332',
                  border: '1px solid #2a3544',
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: ROLE_COLORS[m.role] || '#e7ecf3', fontWeight: 600 }}>
                    {m.role}
                  </span>
                  {m.model && <span style={{ color: '#8b9cb3' }}>{m.model}</span>}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: '#cdd6e3',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {m.content || <em style={{ color: '#8b9cb3' }}>(no content)</em>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
