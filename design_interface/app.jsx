// ---------- App root ----------
function App() {
  const [page, setPage] = useState('dashboard');   // dashboard | returns | analytics | settings | billing
  const [detailRma, setDetailRma] = useState(null);
  const [portal, setPortal] = useState(false);
  const [returns, setReturns] = useState(RETURNS);
  const [shopSettings, setShopSettings] = useState(DEFAULT_SHOP_SETTINGS);
  const updateShopSettings = (patch) => setShopSettings(s => ({ ...s, ...patch }));

  const pendingCount = useMemo(() => returns.filter(r => r.status === 'PENDING').length, [returns]);

  const onOpenReturn = (rma) => setDetailRma(rma);
  const onBackToList = () => setDetailRma(null);

  const updateStatus = (rma, status, patch = {}) => {
    setReturns(rs => rs.map(r => r.rma === rma ? { ...r, status, ...patch } : r));
  };

  const navigate = (key) => {
    setDetailRma(null);
    setPortal(false);
    setPage(key);
  };

  if (portal) {
    return <PortalPage onExit={() => setPortal(false)} shopSettings={shopSettings} />;
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar active={page} onNavigate={navigate} pendingCount={pendingCount} onOpenPortal={() => setPortal(true)} />

      <main className="flex-1 min-w-0">
        {/* Top bar (mobile) */}
        <div className="md:hidden flex items-center gap-3 h-14 px-4 border-b border-divider bg-surface">
          <div className="w-7 h-7 rounded-md grid place-content-center text-white"
            style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' }}>
            <Icon name="RefreshCcw" size={14} strokeWidth={2.5} />
          </div>
          <div className="font-semibold text-[15px]">TrackBack</div>
          <div className="ml-auto flex items-center gap-2 overflow-x-auto">
            {NAV.map(n => (
              <button key={n.key} onClick={() => navigate(n.key)}
                className={`text-[12px] px-2 py-1 rounded ${page === n.key ? 'bg-accent/15 text-accent2' : 'text-muted'}`}>
                {n.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 md:px-10 py-8 max-w-[1280px] mx-auto">
          {detailRma ? (
            <ReturnDetailPage rmaId={detailRma} returns={returns} onBack={onBackToList} onUpdateStatus={updateStatus} />
          ) : (
            <>
              {page === 'dashboard' && <DashboardPage onNavigate={navigate} onOpenReturn={onOpenReturn} returns={returns} />}
              {page === 'returns' && <ReturnsPage returns={returns} onOpenReturn={onOpenReturn} />}
              {page === 'analytics' && <AnalyticsPage />}
              {page === 'settings' && <SettingsPage onOpenPortal={() => setPortal(true)} shopSettings={shopSettings} updateShopSettings={updateShopSettings} />}
              {page === 'billing' && <BillingPage />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// Mount
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
