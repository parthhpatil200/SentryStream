import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import './App.css'

function formatCardToken(cardId) {
  if (!cardId) return '—'
  return `${cardId.slice(0, 6)}…${cardId.slice(-4)}`
}

function formatCurrency(amount) {
  const numericAmount = Number(amount)
  if (Number.isFinite(numericAmount)) {
    return `$${numericAmount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }
  return amount
}

function parseShapExplanation(explanation) {
  if (!explanation) return null
  if (typeof explanation === 'string') {
    try { return JSON.parse(explanation) } catch { return null }
  }
  return explanation
}

function formatFeatureLabel(featureName) {
  return String(featureName)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase())
}

function getFlagReason(explanation) {
  const parsed = parseShapExplanation(explanation)
  if (!parsed) return 'Flagged'
  const entries = Object.entries(parsed).filter(([, v]) => typeof v === 'number')
  if (!entries.length) return 'Flagged'
  const [featureName] = entries.reduce((best, curr) =>
    Math.abs(curr[1]) > Math.abs(best[1]) ? curr : best
  )
  return `Flagged: ${formatFeatureLabel(featureName)}`
}

function normalizeAlert(item) {
  return {
    id: item.transaction_id || item.id || `${item.card_id}-${item.timestamp}`,
    transaction_id: item.transaction_id || '—',
    card_id: item.card_id || '—',
    amount: item.amount || 0,
    merchant: item.merchant || 'Unknown',
    timestamp: item.timestamp || new Date().toISOString(),
    is_fraud: Boolean(item.is_fraud),
    prediction_confidence: item.prediction_confidence || 0,
    flagReason: getFlagReason(item.shap_explanation || item.shapExplanation),
  }
}

function MetricCard({ label, value, icon, variant }) {
  return (
    <article className={`metric-card metric-card--${variant}`}>
      <div className="metric-card__icon" aria-hidden="true">
        <span className={`ti ti-${icon}`} />
      </div>
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
    </article>
  )
}

// Zero-Dependency Dynamic SVG Streaming Chart Component
function StreamingVolumeChart({ alerts }) {
  // Take the last 10 items and reverse them so time moves left-to-right
  const chartData = [...alerts].slice(0, 10).reverse();
  
  // Find the highest transaction value to dynamically scale column heights relative to container bounds
  const maxAmount = Math.max(...chartData.map(d => Number(d.amount) || 1), 1000);
  
  return (
    <section className="table-card" style={{ marginBottom: '24px', padding: '20px' }}>
      <div className="table-card__header" style={{ marginBottom: '16px' }}>
        <div>
          <h2>Real-Time Activity Volume</h2>
          <p className="table-card__subtitle">Visualizing incoming transaction values and fraud distribution timeline</p>
        </div>
      </div>
      
      <div style={{ width: '100%', height: '140px', display: 'flex', alignItems: 'flex-end', gap: '8px', paddingBottom: '8px', borderBottom: '1px solid var(--border-color, #2d3748)' }}>
        {chartData.length === 0 ? (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#718096' }}>
            Awaiting streaming timeline data...
          </div>
        ) : (
          chartData.map((data, idx) => {
            const amountNum = Number(data.amount) || 0;
            // Calculate height percentage capped between 10% minimum and 100% maximum value scale
            const heightPercent = Math.max((amountNum / maxAmount) * 100, 12);
            
            return (
              <div 
                key={data.id || idx} 
                style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center',
                  height: '100%',
                  justifyContent: 'flex-end'
                }}
              >
                <div 
                  style={{
                    width: '100%',
                    height: `${heightPercent}%`,
                    backgroundColor: data.is_fraud ? '#e53e3e' : '#3182ce',
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 0.3s ease, background-color 0.3s ease',
                    position: 'relative',
                    cursor: 'pointer'
                  }}
                  title={`${data.merchant}: ${formatCurrency(amountNum)} (${data.is_fraud ? 'Fraud' : 'Safe'})`}
                />
                <span style={{ fontSize: '10px', color: '#718096', marginTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60px' }}>
                  {data.merchant}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  )
}

function App() {
  const [alerts, setAlerts] = useState([])
  const [metrics, setMetrics] = useState({
    totalTransactions: 0,
    fraudCases: 0,
    fraudRate: 0,
  })

  useEffect(() => {
    let isMounted = true
    const socket = io('http://127.0.0.1:5000', { transports: ['websocket'] }) // Forced IPv4 routing stability

    const loadHistory = async () => {
      try {
        const response = await fetch('http://127.0.0.1:5000/api/history')
        if (!response.ok) throw new Error(`History request failed with ${response.status}`)
        const history = await response.json()
        if (!isMounted) return
        const normalized = history.map(normalizeAlert)
        const fraudCases = normalized.filter((a) => a.is_fraud).length
        setAlerts(normalized.slice(0, 10))
        setMetrics({
          totalTransactions: normalized.length,
          fraudCases,
          fraudRate: normalized.length ? (fraudCases / normalized.length) * 100 : 0,
        })
      } catch (err) {
        console.error('Unable to load history:', err)
      }
    }

    loadHistory()

    socket.on('connect', () => console.log('Connected to streaming gateway'))
    socket.on('new_alert', (payload) => {
      const alert = normalizeAlert(payload)
      setAlerts((prev) => [alert, ...prev].slice(0, 10))
      setMetrics((prev) => {
        const total = prev.totalTransactions + 1
        const fraud = prev.fraudCases + (alert.is_fraud ? 1 : 0)
        return { totalTransactions: total, fraudCases: fraud, fraudRate: total ? (fraud / total) * 100 : 0 }
      })
    })

    return () => { isMounted = false; socket.disconnect() }
  }, [])

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          <p className="eyebrow">SentryStream</p>
          <h1>Monitoring Dashboard</h1>
        </div>
        <div className="live-pill">
          <span className="live-pill__dot" aria-hidden="true" />
          Live stream active
        </div>
      </header>

      <section className="metrics-grid" aria-label="Summary metrics">
        <MetricCard
          label="Total Transactions Processed"
          value={metrics.totalTransactions.toLocaleString()}
          icon="activity"
          variant="blue"
        />
        <MetricCard
          label="Fraud Cases Detected"
          value={metrics.fraudCases.toLocaleString()}
          icon="shield-exclamation"
          variant="red"
        />
        <MetricCard
          label="Current Fraud Rate"
          value={`${metrics.fraudRate.toFixed(1)}%`}
          icon="chart-pie"
          variant="amber"
        />
      </section>

      {/* Embedded Chart Section rendering the state flow */}
      <StreamingVolumeChart alerts={alerts} />

      <section className="table-card">
        <div className="table-card__header">
          <div>
            <h2>Recent Transactions</h2>
            <p className="table-card__subtitle">Streaming from Redis + PostgreSQL</p>
          </div>
          <span className="source-badge">
            <span className="ti ti-database" aria-hidden="true" />
            Live feed
          </span>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Transaction ID</th>
                <th>Card Token</th>
                <th>Amount</th>
                <th>Merchant</th>
                <th>Confidence</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {alerts.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    <span className="ti ti-loader" aria-hidden="true" />
                    Waiting for transactions…
                  </td>
                </tr>
              )}
              {alerts.map((alert) => (
                <tr key={alert.id} className={alert.is_fraud ? 'row--fraud' : ''}>
                  <td className="cell--mono">{alert.transaction_id}</td>
                  <td className="cell--mono cell--muted">{formatCardToken(alert.card_id)}</td>
                  <td className="cell--amount">{formatCurrency(alert.amount)}</td>
                  <td>{alert.merchant}</td>
                  <td>
                    <div className="confidence-bar">
                      <div
                        className={`confidence-bar__fill ${alert.is_fraud ? 'confidence-bar__fill--fraud' : 'confidence-bar__fill--safe'}`}
                        style={{ width: `${Math.round(alert.prediction_confidence * 100)}%` }}
                      />
                      <span className="confidence-bar__label">
                        {Math.round(alert.prediction_confidence * 100)}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="status-cell">
                      <span className={`status-badge ${alert.is_fraud ? 'status-badge--fraud' : 'status-badge--safe'}`}>
                        {alert.is_fraud
                          ? <><span className="ti ti-alert-triangle" aria-hidden="true" /> Fraud</>
                          : <><span className="ti ti-circle-check" aria-hidden="true" /> Safe</>
                        }
                      </span>
                      {alert.is_fraud && <small className="flag-reason">{alert.flagReason}</small>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default App