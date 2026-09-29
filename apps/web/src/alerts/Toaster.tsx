import { useAlerts } from './index.js';

export function Toaster() {
  const { items, alerts } = useAlerts();
  return <div className="toaster" aria-label="Notifications">
    {items.map(item => <div key={item.id} className={`toast toast-${item.level}`}
      role={item.level === 'error' ? 'alert' : 'status'} aria-live={item.level === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={() => alerts.pause(item.id)} onMouseLeave={() => alerts.resume(item.id)}
      onFocus={() => alerts.pause(item.id)} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) alerts.resume(item.id);
      }}>
      <div className="toast-heading"><strong>{item.title ?? item.level}</strong>
        {item.count > 1 && <span className="toast-count">×{item.count}</span>}
        <button type="button" aria-label="Dismiss notification" onClick={() => alerts.dismiss(item.id)}>×</button></div>
      <p>{item.message}</p>
      {item.details && <details><summary>Details</summary><pre>{item.details}</pre></details>}
    </div>)}
  </div>;
}
