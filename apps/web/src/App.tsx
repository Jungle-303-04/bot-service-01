import { useEffect, useMemo, useRef, useState } from 'react';

interface Pod {
  name: string;
  phase: string;
  ready: boolean;
  restarts: number;
  node: string;
  pod_ip?: string;
  age_seconds: number;
}

interface Cluster {
  available: boolean;
  namespace: string;
  deployment: string;
  desired_replicas: number;
  ready_replicas: number;
  available_replicas: number;
  updated_replicas: number;
  pods: Pod[];
  hpa: {
    available: boolean;
    min_replicas?: number;
    max_replicas?: number;
    target_cpu_utilization?: number | null;
    current_cpu_utilization?: number | null;
    current_replicas?: number;
    desired_replicas?: number;
  };
  error?: string;
  reason?: string;
}

interface Status {
  service: string;
  title: string;
  kind: string;
  version: string;
  flavor: string;
  generated_at: string;
  scenarios: Record<string, boolean>;
  metrics: { p95_latency_ms: number; request_samples: number; background_tasks: number };
  rows: Record<string, number>;
  cluster: Cluster;
}

interface Product { id: number; name: string; price_cents: number; stock: number }
interface Order { id: number; status: string; total_cents: number; created_at: string }

const scenarios = [
  ['scale-surge/start', 'Pod Surge', 'Deployment 2 -> 6+'],
  ['load/start', 'Traffic Burn', 'CPU pressure'],
  ['db-bulk-insert/start', 'Bulk Save', 'orders + audit'],
  ['db-lock/start', 'DB Lock', 'inventory lock'],
  ['db-slow-query/start', 'Slow Query', 'latency injection'],
  ['error-spike/start', 'Error Spike', 'intentional 5xx'],
  ['crashloop/start', 'CrashLoop', 'pod restart'],
  ['recover', 'Recover', 'replicas 6 -> 2'],
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function podShort(name: string) {
  return name.split('-').slice(-2).join('-');
}

function age(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [notice, setNotice] = useState('cluster signal standby');
  const [busy, setBusy] = useState('');
  const [storming, setStorming] = useState(false);
  const stormRef = useRef<number | null>(null);

  const refresh = async () => {
    const [s, p, o] = await Promise.all([
      api<Status>('/api/status'),
      api<{ products: Product[] }>('/api/products').catch(() => ({ products: [] })),
      api<{ orders: Order[] }>('/api/orders').catch(() => ({ orders: [] })),
    ]);
    setStatus(s);
    setProducts(p.products);
    setOrders(o.orders);
  };

  const stopStorm = () => {
    if (stormRef.current) {
      window.clearInterval(stormRef.current);
      stormRef.current = null;
    }
    setStorming(false);
  };

  const startStorm = (durationMs: number) => {
    stopStorm();
    setStorming(true);
    const deadline = Date.now() + durationMs;
    stormRef.current = window.setInterval(() => {
      if (Date.now() > deadline) {
        stopStorm();
        return;
      }
      void Promise.allSettled([
        api('/api/work', { method: 'POST' }),
        api('/api/work', { method: 'POST' }),
        api('/api/work', { method: 'POST' }),
      ]);
    }, 380);
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 1800);
    return () => {
      window.clearInterval(id);
      stopStorm();
    };
  }, []);

  const cluster = status?.cluster;
  const activeCount = status ? Object.values(status.scenarios).filter(Boolean).length : 0;
  const desired = cluster?.desired_replicas ?? 2;
  const ready = cluster?.ready_replicas ?? 0;
  const podCount = cluster?.pods.length ?? 0;
  const surgeActive = Boolean(status?.scenarios.scale_surge) || desired > 2 || storming;
  const pressure = useMemo(() => {
    if (!status) return 0;
    const replicaPressure = Math.min(Math.max(desired - 2, 0) / 4, 0.42);
    const latencyPressure = Math.min(status.metrics.p95_latency_ms / 1000, 0.34);
    return Math.min(1, replicaPressure + latencyPressure + activeCount * 0.08 + (storming ? 0.16 : 0));
  }, [status, desired, activeCount, storming]);
  const slots = Math.max(6, desired, podCount);
  const readinessPct = desired ? Math.round((ready / desired) * 100) : 0;

  const runScenario = async (name: string, label: string) => {
    setBusy(label);
    try {
      await api(`/api/scenarios/${name}`, { method: 'POST' });
      if (name === 'scale-surge/start') startStorm(65000);
      if (name === 'load/start') startStorm(30000);
      if (name === 'recover' || name === 'scale-surge/stop') stopStorm();
      setNotice(`${label} dispatched`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'scenario failed');
    } finally {
      setBusy('');
    }
  };

  const createOrder = async () => {
    setBusy('Create Order');
    try {
      await api('/api/orders', { method: 'POST' });
      setNotice('order persisted');
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'order failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="shell" style={{ ['--pressure' as string]: pressure }}>
      <section className="ops-bar">
        <div>
          <p className="label">bot-service-01 / checkout</p>
          <h1>Checkout Pulse</h1>
        </div>
        <div className="release">
          <span>{status?.version ?? 'loading'}</span>
          <strong>{status?.flavor ?? 'stable'}</strong>
        </div>
      </section>

      <section className="stage">
        <aside className="panel command">
          <div className="panel-title">
            <strong>Scenario Console</strong>
            <span>{notice}</span>
          </div>
          <div className="surge-card">
            <button onClick={() => runScenario('scale-surge/start', 'Pod Surge')} disabled={!!busy}>
              <b>Pod Surge</b>
              <span>2 to 6+ replicas</span>
            </button>
            <button onClick={() => runScenario('recover', 'Recover')} disabled={!!busy}>
              <b>Recover</b>
              <span>back to 2 replicas</span>
            </button>
          </div>
          <div className="buttons">
            {scenarios.slice(1, -1).map(([path, label, desc]) => (
              <button key={path} onClick={() => runScenario(path, label)} disabled={!!busy} title={desc}>
                <span>{label}</span>
                <small>{busy === label ? 'running' : desc}</small>
              </button>
            ))}
          </div>
          <button className="primary" onClick={createOrder} disabled={!!busy}>Create Checkout Event</button>
        </aside>

        <section className={`panel cluster ${surgeActive ? 'surging' : ''}`}>
          <div className="panel-title">
            <strong>Live API Pods</strong>
            <span>{cluster?.deployment ?? 'deployment'} · {cluster?.namespace ?? 'namespace'}</span>
          </div>
          <div className="replica-board">
            <div>
              <span>ready</span>
              <strong>{ready}/{desired}</strong>
            </div>
            <div>
              <span>pods</span>
              <strong>{podCount}</strong>
            </div>
            <div>
              <span>p95</span>
              <strong>{Math.round(status?.metrics.p95_latency_ms ?? 0)}ms</strong>
            </div>
            <div>
              <span>hpa cpu</span>
              <strong>{cluster?.hpa.current_cpu_utilization ?? 0}%/{cluster?.hpa.target_cpu_utilization ?? 60}%</strong>
            </div>
          </div>
          <div className="readiness">
            <i style={{ width: `${Math.min(100, readinessPct)}%` }} />
          </div>
          <div className="pod-grid">
            {Array.from({ length: slots }, (_, i) => {
              const pod = cluster?.pods[i];
              return (
                <article className={`pod ${pod?.ready ? 'ready' : pod ? 'pending' : 'empty'}`} key={pod?.name ?? i}>
                  <b>{pod ? podShort(pod.name) : 'warming'}</b>
                  <span>{pod ? `${pod.phase} · ${age(pod.age_seconds)}` : 'slot'}</span>
                  <em>{pod ? `restart ${pod.restarts}` : 'pending'}</em>
                </article>
              );
            })}
          </div>
          {cluster?.error && <p className="cluster-error">{cluster.error}</p>}
        </section>

        <section className="heat-panel">
          <div className="heat-head">
            <strong>Checkout Load Heat</strong>
            <span>{storming ? 'traffic storm active' : `${activeCount} scenario active`}</span>
          </div>
          <div className="flow-lanes">
            {['cart', 'order', 'payment', 'inventory'].map((lane, i) => (
              <div className="lane" key={lane} style={{ ['--i' as string]: i }}>
                <span>{lane}</span>
                <i />
                <i />
                <i />
              </div>
            ))}
          </div>
          <div className="heat">
            {Array.from({ length: 54 }, (_, i) => (
              <span key={i} style={{ ['--n' as string]: i }} />
            ))}
          </div>
        </section>
      </section>

      <section className="metrics">
        <Metric label="Orders" value={status?.rows.orders ?? 0} />
        <Metric label="Payments" value={status?.rows.payments ?? 0} />
        <Metric label="Audit rows" value={status?.rows.audit_logs ?? 0} />
        <Metric label="Telemetry" value={status?.rows.telemetry_samples ?? 0} />
      </section>

      <section className="split">
        <div className="panel">
          <div className="panel-title"><strong>Products</strong><span>PostgreSQL</span></div>
          <div className="rows">
            {products.map(p => <div key={p.id}><b>{p.name}</b><span>{(p.price_cents / 100).toLocaleString()}원 · stock {p.stock}</span></div>)}
          </div>
        </div>
        <div className="panel">
          <div className="panel-title"><strong>Recent Orders</strong><span>latest 20</span></div>
          <div className="rows">
            {orders.length === 0 && <div><b>empty</b><span>waiting for checkout</span></div>}
            {orders.map(o => <div key={o.id}><b>#{o.id} · {o.status}</b><span>{(o.total_cents / 100).toLocaleString()}원 · {new Date(o.created_at).toLocaleTimeString()}</span></div>)}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="metric"><span>{label}</span><strong>{Math.round(value).toLocaleString()}</strong></div>;
}
