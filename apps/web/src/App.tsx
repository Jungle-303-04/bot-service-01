import { useEffect, useMemo, useState } from 'react';

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
}

interface Product { id: number; name: string; price_cents: number; stock: number }
interface Order { id: number; status: string; total_cents: number; created_at: string }

const scenarios = [
  ['load/start', '트래픽 폭주', 'CPU를 태워 HPA와 latency 상승을 유도합니다.'],
  ['db-bulk-insert/start', '대량 저장', '주문과 감사 로그를 빠르게 적재합니다.'],
  ['db-lock/start', 'DB 락', '재고 row lock으로 주문 지연을 만듭니다.'],
  ['db-slow-query/start', '느린 쿼리', '모든 API에 짧은 pg_sleep을 주입합니다.'],
  ['error-spike/start', '에러율 증가', '체크아웃 API 5xx를 의도적으로 발생시킵니다.'],
  ['crashloop/start', 'Pod Crash', '프로세스를 종료해 CrashLoop 증거를 만듭니다.'],
  ['recover', '앱 복구', '주입된 런타임 장애 플래그를 해제합니다.'],
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [notice, setNotice] = useState('관측 대기 중');
  const [busy, setBusy] = useState('');

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

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 2500);
    return () => window.clearInterval(id);
  }, []);

  const hotScore = useMemo(() => {
    if (!status) return 0;
    const active = Object.values(status.scenarios).filter(Boolean).length;
    return Math.min(1, active * 0.22 + Math.min(status.metrics.p95_latency_ms / 1200, 0.55));
  }, [status]);

  const runScenario = async (name: string, label: string) => {
    setBusy(label);
    try {
      await api(`/api/scenarios/${name}`, { method: 'POST' });
      setNotice(`${label} 시나리오가 시작됐습니다`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '시나리오 실행 실패');
    } finally {
      setBusy('');
    }
  };

  const createOrder = async () => {
    setBusy('주문 생성');
    try {
      await api('/api/orders', { method: 'POST' });
      setNotice('주문이 생성되고 결제 이벤트가 DB에 기록됐습니다');
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '주문 실패');
    } finally {
      setBusy('');
    }
  };

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="label">bot-service-01</p>
          <h1>Checkout Pulse</h1>
          <p className="copy">주문, 결제, 재고, DB 장애를 한 화면에서 발생시키고 RCA/롤백 흐름을 보여주는 발표용 체크아웃 서비스입니다.</p>
        </div>
        <div className="version">
          <span>{status?.version ?? 'loading'}</span>
          <strong>{status?.flavor ?? 'stable'}</strong>
        </div>
      </section>

      <section className="grid">
        <div className="panel control">
          <div className="panel-title">
            <strong>Scenario Console</strong>
            <span>{notice}</span>
          </div>
          <div className="buttons">
            {scenarios.map(([path, label, desc]) => (
              <button key={path} onClick={() => runScenario(path, label)} disabled={!!busy} title={desc}>
                <span>{label}</span>
                <small>{busy === label ? 'running' : desc}</small>
              </button>
            ))}
          </div>
          <button className="primary" onClick={createOrder} disabled={!!busy}>주문 1건 생성</button>
        </div>

        <div className="panel live">
          <div className="panel-title">
            <strong>Checkout Heat</strong>
            <span>p95 {status?.metrics.p95_latency_ms ?? 0}ms</span>
          </div>
          <div className="heat" style={{ ['--heat' as string]: hotScore }}>
            {Array.from({ length: 36 }, (_, i) => (
              <span key={i} style={{ animationDelay: `${i * 35}ms` }} />
            ))}
          </div>
          <div className="pipeline">
            {['Cart', 'Order', 'Payment', 'Inventory', 'Receipt'].map((step, i) => (
              <div key={step} className={hotScore > i * 0.18 ? 'hot' : ''}>{step}</div>
            ))}
          </div>
        </div>
      </section>

      <section className="metrics">
        <Metric label="Orders" value={status?.rows.orders ?? 0} />
        <Metric label="Payments" value={status?.rows.payments ?? 0} />
        <Metric label="Audit rows" value={status?.rows.audit_logs ?? 0} />
        <Metric label="Tasks" value={status?.metrics.background_tasks ?? 0} />
      </section>

      <section className="split">
        <div className="panel">
          <div className="panel-title"><strong>Products</strong><span>DB backed</span></div>
          <div className="rows">
            {products.map(p => <div key={p.id}><b>{p.name}</b><span>{(p.price_cents / 100).toLocaleString()}원 · stock {p.stock}</span></div>)}
          </div>
        </div>
        <div className="panel">
          <div className="panel-title"><strong>Recent Orders</strong><span>latest 20</span></div>
          <div className="rows">
            {orders.length === 0 && <div><b>주문 없음</b><span>버튼을 눌러 주문을 생성하세요</span></div>}
            {orders.map(o => <div key={o.id}><b>#{o.id} · {o.status}</b><span>{(o.total_cents / 100).toLocaleString()}원 · {new Date(o.created_at).toLocaleTimeString()}</span></div>)}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="metric"><span>{label}</span><strong>{value.toLocaleString()}</strong></div>;
}

