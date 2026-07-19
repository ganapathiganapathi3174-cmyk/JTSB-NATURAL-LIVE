export function TableSkeleton({ rows = 5, cols = 6 }) {
  return (
    <div className="table-wrap-modern">
      <table>
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}><div className="skeleton skeleton-line-sm" style={{ width: '60%' }} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <div className="skeleton skeleton-line-sm" style={{ width: `${40 + Math.random() * 40}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CardSkeleton({ count = 4 }) {
  return (
    <div className="stats-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass skeleton-card-modern" style={{ borderRadius: 'var(--radius-lg)' }}>
          <div className="skeleton skeleton-line-sm" style={{ width: '40%', marginBottom: '0.5rem' }} />
          <div className="skeleton skeleton-line-lg" style={{ width: '60%' }} />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="admin-content-inner animate-fade-in-up">
      <div className="admin-page-header">
        <div className="skeleton skeleton-line-lg" style={{ width: '200px', height: '28px' }} />
      </div>
      <CardSkeleton count={4} />
      <div style={{ marginTop: '1.5rem' }}>
        <div className="glass skeleton-card-modern" style={{ borderRadius: 'var(--radius-lg)' }}>
          <div className="skeleton skeleton-line" style={{ width: '160px', marginBottom: '1rem' }} />
          <TableSkeleton rows={4} cols={5} />
        </div>
      </div>
    </div>
  );
}
