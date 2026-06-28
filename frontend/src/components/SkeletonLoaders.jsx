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
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(160px, 1fr))`, gap: '0.75rem' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card-modern" style={{
          background: '#fff', borderRadius: '10px', padding: '1.25rem',
          border: '1px solid var(--border, #e5e7eb)',
        }}>
          <div className="skeleton skeleton-line-sm" style={{ width: '40%', marginBottom: '0.5rem' }} />
          <div className="skeleton skeleton-line-lg" style={{ width: '60%' }} />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="admin-content-inner">
      <div className="admin-page-header">
        <div className="skeleton skeleton-line-lg" style={{ width: '200px', height: '28px' }} />
      </div>
      <CardSkeleton count={4} />
      <div style={{ marginTop: '1.5rem' }}>
        <div className="skeleton-card-modern" style={{
          background: '#fff', borderRadius: '10px', padding: '1.25rem',
          border: '1px solid var(--border, #e5e7eb)',
        }}>
          <div className="skeleton skeleton-line" style={{ width: '160px', marginBottom: '1rem' }} />
          <TableSkeleton rows={4} cols={5} />
        </div>
      </div>
    </div>
  );
}
