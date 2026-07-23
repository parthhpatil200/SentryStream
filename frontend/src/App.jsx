import { useEffect, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import './App.css'
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
let globalSocket = null;

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
    shap_explanation: item.shap_explanation || item.shapExplanation,
    flagReason: getFlagReason(item.shap_explanation || item.shapExplanation),
    location: item.location || 'Unknown'
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

function StreamingVolumeChart({ chartAlerts, page, onPrevPage, onNextPage, onSelectBar }) {
  // Reverse the window array slice so the newest entries continuously slide in from the right edge smoothly
  const chartData = [...chartAlerts].slice(0, 10).reverse();
  const maxAmount = Math.max(...chartData.map(d => Number(d.amount) || 1), 1000);
  
  return (
    <section className="table-card" style={{ marginBottom: '24px', padding: '20px' }}>
      <div className="table-card__header" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Real-Time Activity Volume & Trend Matrix</h2>
          <p className="table-card__subtitle">
            {page === 0 ? 'Viewing active streaming timeline window' : `Viewing database historical slice (Page ${page} back)`}
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button 
            onClick={onPrevPage} 
            style={{ padding: '6px 12px', backgroundColor: '#2d3748', border: '1px solid #4a5568', color: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            ← Back
          </button>
          <button 
            onClick={onNextPage} 
            disabled={page === 0}
            style={{ padding: '6px 12px', backgroundColor: page === 0 ? '#1a202c' : '#2d3748', border: '1px solid #4a5568', color: page === 0 ? '#4a5568' : 'white', borderRadius: '4px', cursor: page === 0 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}
          >
            Forward →
          </button>
        </div>
      </div>
      
      <div style={{ width: '100%', height: '140px', display: 'flex', alignItems: 'flex-end', gap: '8px', paddingBottom: '8px', borderBottom: '1px solid #2d3748' }}>
        {chartData.length === 0 ? (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#718096' }}>
            No transaction units present for this quadrant.
          </div>
        ) : (
          chartData.map((data, idx) => {
            const amountNum = Number(data.amount) || 0;
            const heightPercent = Math.max((amountNum / maxAmount) * 100, 12);
            return (
              <div key={data.id || idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                <div 
                  onClick={() => onSelectBar(data)}
                  style={{
                    width: '100%',
                    height: `${heightPercent}%`,
                    backgroundColor: data.is_fraud ? '#e53e3e' : '#3182ce',
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 0.2s ease, background-color 0.2s ease',
                    position: 'relative',
                    cursor: 'pointer'
                  }}
                  title={`Click to analyze ${data.merchant}: ${formatCurrency(amountNum)}`}
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

function ShapExplanationModal({ alert, onClose }) {
  if (!alert) return null;
  const parsedFeatures = parseShapExplanation(alert.shap_explanation) || {};
  const featureEntries = Object.entries(parsedFeatures);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        backgroundColor: '#1a202c', border: '1px solid #2d3748', borderRadius: '12px',
        padding: '24px', width: '90%', maxWidth: '500px', color: '#e2e8f0', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: alert.is_fraud ? '#f56565' : '#4299e1', fontWeight: 'bold' }}>
              Decision Reason Matrix
            </span>
            <h3 style={{ margin: '4px 0 0 0', fontSize: '18px' }}>Transaction Analysis</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#a0aec0', fontSize: '20px', cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ background: '#2d3748', padding: '12px', borderRadius: '6px', marginBottom: '20px', fontSize: '13px' }}>
          <p style={{ margin: '0 0 6px 0' }}><strong>ID:</strong> <span style={{ fontFamily: 'monospace' }}>{alert.transaction_id}</span></p>
          <p style={{ margin: '0 0 6px 0' }}><strong>Merchant:</strong> {alert.merchant} | <strong>Location:</strong> {alert.location}</p>
          <p style={{ margin: '0' }}><strong>Amount:</strong> {formatCurrency(alert.amount)}</p>
        </div>

        <h4 style={{ fontSize: '14px', margin: '0 0 12px 0', color: '#a0aec0' }}>XGBoost + TreeSHAP Feature Weighting:</h4>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
          {featureEntries.length === 0 ? (
            <p style={{ fontSize: '13px', color: '#718096', margin: '0' }}>No mathematical vectors stored for this event.</p>
          ) : (
            featureEntries.map(([name, val]) => {
              const weight = Number(val) || 0;
              const isPositive = weight >= 0;
              const barWidth = Math.min((Math.abs(weight) / 5) * 100, 100);

              return (
                <div key={name} style={{ fontSize: '13px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontWeight: '500' }}>{formatFeatureLabel(name)}</span>
                    <span style={{ color: isPositive ? '#f56565' : '#48bb78', fontFamily: 'monospace' }}>
                      {isPositive ? `+${weight.toFixed(4)}` : weight.toFixed(4)}
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '8px', backgroundColor: '#4a5568', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${barWidth}%`, height: '100%', backgroundColor: isPositive ? '#e53e3e' : '#38a169', borderRadius: '4px' }} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <button onClick={onClose} style={{ width: '100%', padding: '10px', backgroundColor: '#3182ce', color: 'white', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' }}>
          Dismiss Diagnostics Panel
        </button>
      </div>
    </div>
  );
}

function App() {
  const [liveAlerts, setLiveAlerts] = useState([]) // Strictly holds the live 10 rolling entries
  const [historyAlerts, setHistoryAlerts] = useState([]) // Holds historical query frames separately
  const [frozenCards, setFrozenCards] = useState(new Set())
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [chartPage, setChartPage] = useState(0) // Tracks the chart timeline index page independently
  const [metrics, setMetrics] = useState({ totalTransactions: 0, fraudCases: 0, fraudRate: 0 })

  const fetchHistoryPage = useCallback(async (targetPage) => {
    if (targetPage === 0) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/history?page=${targetPage}&limit=10`)
      if (!response.ok) throw new Error(`History error: ${response.status}`)
      const data = await response.json()
      setHistoryAlerts(data.map(normalizeAlert))
    } catch (err) {
      console.error('Failed to load historical window frame:', err)
    }
  }, []);

  useEffect(() => {
    let isMounted = true
    const socket = io(BACKEND_URL, { transports: ['websocket'] })
    globalSocket = socket;

    const loadInitialHistory = async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/api/history?page=0&limit=10`)
        if (!response.ok) throw new Error(`Startup error: ${response.status}`)
        const history = await response.json()
        if (!isMounted) return
        setLiveAlerts(history.map(normalizeAlert).slice(0, 10))
      } catch (err) {
        console.error('Unable to fetch base cache layer:', err)
      }
    }

    loadInitialHistory()

    socket.on('connect', () => console.log('Connected to streaming gateway'))
    socket.on('new_alert', (payload) => {
      const alert = normalizeAlert(payload)
      
      // IMPLEMENTATION: Strict rolling sliding window queue logic. Max 10 rows always.
      setLiveAlerts((prev) => [alert, ...prev].slice(0, 10))
      
      setMetrics((prev) => {
        const total = prev.totalTransactions + 1
        const fraud = prev.fraudCases + (payload.is_fraud ? 1 : 0)
        return { totalTransactions: total, fraudCases: fraud, fraudRate: total ? (fraud / total) * 100 : 0 }
      })
    })

    return () => { isMounted = false; socket.disconnect() }
  }, [])

  const handlePrevPage = () => {
    const nextPage = chartPage + 1;
    setChartPage(nextPage);
    fetchHistoryPage(nextPage);
  }

  const handleNextPage = () => {
    if (chartPage > 0) {
      const nextPage = chartPage - 1;
      setChartPage(nextPage);
      if (nextPage > 0) {
        fetchHistoryPage(nextPage);
      }
    }
  }

  const handleFreezeCard = (e, cardId) => {
    e.stopPropagation();
    if (globalSocket && globalSocket.connected) {
      globalSocket.emit('freeze_card', { card_id: cardId });
      setFrozenCards((prev) => new Set([...prev, cardId]));
    }
  }

  // Determine what dataset context the chart draws from
  const activeChartDataset = chartPage === 0 ? liveAlerts : historyAlerts;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          <p className="eyebrow">SentryStream</p>
          <h1>Monitoring Dashboard</h1>
        </div>
        <div className="live-pill">
          <span className="live-pill__dot" style={{ backgroundColor: chartPage === 0 ? '#48bb78' : '#a0aec0' }} aria-hidden="true" />
          {chartPage === 0 ? 'Live stream active' : `Viewing Historical Log (Page ${chartPage})`}
        </div>
      </header>

      <section className="metrics-grid" aria-label="Summary metrics">
        <MetricCard label="Total Transactions Processed" value={metrics.totalTransactions.toLocaleString()} icon="activity" variant="blue" />
        <MetricCard label="Fraud Cases Detected" value={metrics.fraudCases.toLocaleString()} icon="shield-exclamation" variant="red" />
        <MetricCard label="Current Fraud Rate" value={`${metrics.fraudRate.toFixed(1)}%`} icon="chart-pie" variant="amber" />
      </section>

      {/* Dynamic chart linked to the scrolling data views */}
      <StreamingVolumeChart 
        chartAlerts={activeChartDataset} 
        page={chartPage}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
        onSelectBar={(alert) => setSelectedAlert(alert)}
      />

      <section className="table-card">
        <div className="table-card__header">
          <div>
            <h2>Recent Live Transactions Ledger</h2>
            <p className="table-card__subtitle">Displaying steady rolling window loop of incoming network packets.</p>
          </div>
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
                <th>Status / Actions</th>
              </tr>
            </thead>
            <tbody>
              {liveAlerts.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">Waiting for transaction streams…</td>
                </tr>
              )}
              {liveAlerts.map((alert) => {
                const isFrozen = frozenCards.has(alert.card_id);
                return (
                  <tr key={alert.id} onClick={() => setSelectedAlert(alert)} className={alert.is_fraud ? 'row--fraud' : ''} style={{ cursor: 'pointer' }}>
                    <td className="cell--mono">{alert.transaction_id}</td>
                    <td className="cell--mono cell--muted">{formatCardToken(alert.card_id)}</td>
                    <td className="cell--amount">{formatCurrency(alert.amount)}</td>
                    <td>{alert.merchant}</td>
                    <td>
                      <div className="confidence-bar">
                        <div className={`confidence-bar__fill ${alert.is_fraud ? 'confidence-bar__fill--fraud' : 'confidence-bar__fill--safe'}`} style={{ width: `${Math.round(alert.prediction_confidence * 100)}%` }} />
                        <span className="confidence-bar__label">{Math.round(alert.prediction_confidence * 100)}%</span>
                      </div>
                    </td>
                    <td>
                      <div className="status-cell" style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'space-between' }}>
                        <span className={`status-badge ${alert.is_fraud ? 'status-badge--fraud' : 'status-badge--safe'}`}>
                          {alert.is_fraud ? 'Fraud' : 'Safe'}
                        </span>
                        {alert.is_fraud && (
                          <button
                            onClick={(e) => handleFreezeCard(e, alert.card_id)}
                            disabled={isFrozen}
                            style={{
                              padding: '5px 10px', fontSize: '11px', fontWeight: '600',
                              backgroundColor: isFrozen ? '#4a5568' : '#e53e3e', color: 'white',
                              border: 'none', borderRadius: '4px', cursor: isFrozen ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap', zIndex: 10
                            }}
                          >
                            {isFrozen ? '🛡️ Frozen' : '🛑 Freeze'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {selectedAlert && <ShapExplanationModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />}
    </div>
  )
}

export default App

