// ---------- Settings ----------
function SettingsPage({ onOpenPortal, shopSettings, updateShopSettings }) {
  const [tab, setTab] = useState('General');
  const tabs = [
    { key: 'General', icon: 'Settings2' },
    { key: 'Reasons', icon: 'Tag' },
    { key: 'Emails', icon: 'Mail' },
    { key: 'Branding', icon: 'Palette' },
    { key: 'Policy', icon: 'FileText' },
  ];

  return (
    <div>
      <PageHeader title="Settings" subtitle="Configure how returns work for your store." />

      {/* Secondary tab nav */}
      <div className="flex items-center gap-1 border-b border-divider mb-6 overflow-x-auto">
        {tabs.map(t => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`relative inline-flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${active ? 'text-ink' : 'text-muted hover:text-ink'}`}>
              <Icon name={t.icon} size={13.5} />
              {t.key}
              {active && <span className="absolute left-2 right-2 -bottom-px h-[2px] bg-accent rounded-full" />}
            </button>
          );
        })}
      </div>

      {tab === 'General' && <GeneralTab shopSettings={shopSettings} updateShopSettings={updateShopSettings} />}
      {tab === 'Reasons' && <ReasonsTab />}
      {tab === 'Emails' && <EmailsTab />}
      {tab === 'Branding' && <BrandingTab onOpenPortal={onOpenPortal} />}
      {tab === 'Policy' && <PolicyTab />}
    </div>
  );
}

function SettingRow({ label, hint, children, wide }) {
  return (
    <div className={`py-5 border-b border-divider last:border-0 grid ${wide ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-[260px_1fr]'} gap-3 md:gap-8`}>
      <div className="pt-1">
        <div className="text-[13.5px] font-semibold text-ink">{label}</div>
        {hint && <div className="text-[12px] text-muted mt-1 leading-relaxed max-w-[260px]">{hint}</div>}
      </div>
      <div className="max-w-xl">{children}</div>
    </div>
  );
}

function SaveBar({ onSave }) {
  const toast = useToast();
  return (
    <div className="mt-6 flex items-center justify-end gap-2">
      <Btn variant="ghost">Discard</Btn>
      <Btn variant="primary" icon="Check" onClick={() => { onSave?.(); toast({ kind: 'success', title: 'Settings saved' }); }}>Save Changes</Btn>
    </div>
  );
}

// ---- General tab ----
function GeneralTab({ shopSettings, updateShopSettings }) {
  const [returnWindow, setReturnWindow] = useState(30);
  const [address, setAddress] = useState('Acme Store — Returns\n1450 Mission St, Suite 200\nSan Francisco, CA 94103\nUnited States');
  const [autoApprove, setAutoApprove] = useState(false);
  const [notify, setNotify] = useState(true);
  const [fromEmail, setFromEmail] = useState('returns@acmestore.com');

  return (
    <div className="bg-surface border border-border rounded-lg px-6">
      <SettingRow label="Return window" hint="How many days after delivery customers can request a return.">
        <div className="flex items-center gap-2">
          <input type="number" value={returnWindow} onChange={e => setReturnWindow(+e.target.value)}
            className="w-24 h-9 px-3 text-[13px] rounded-md bg-bg border border-border text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-center tabular-nums" />
          <span className="text-[13px] text-muted">days</span>
        </div>
      </SettingRow>

      <SettingRow label="Return address" hint="Shown on the customer-facing return label and confirmation emails.">
        <Textarea value={address} onChange={e => setAddress(e.target.value)} rows={4} />
      </SettingRow>

      <SettingRow label="Auto-approve returns" hint="Skip manual review for returns under your return window.">
        <Toggle checked={autoApprove} onChange={setAutoApprove}
          label={autoApprove ? 'Returns are auto-approved' : 'Manual review required'}
          description="Recommended off until your reason policy is tuned." />
      </SettingRow>

      <SettingRow label="Notify merchant" hint="Get an email each time a customer files a new return.">
        <Toggle checked={notify} onChange={setNotify}
          label="Email me when a new request comes in"
          description={fromEmail} />
      </SettingRow>

      <SettingRow label="From email" hint="The reply-to address on automated emails to customers.">
        <Input value={fromEmail} onChange={e => setFromEmail(e.target.value)} type="email" />
      </SettingRow>

      {/* Revenue Retention section */}
      <div className="py-6 border-b border-divider last:border-0">
        <div className="mb-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-md grid place-content-center shrink-0" style={{ background: 'rgba(108,99,255,0.15)', color: '#8B85FF' }}>
            <Icon name="TrendingUp" size={16} />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-ink">Revenue Retention</div>
            <div className="text-[12.5px] text-muted mt-0.5 max-w-md leading-relaxed">
              Encourage customers to keep revenue in your store instead of requesting refunds.
            </div>
          </div>
        </div>

        <div className="space-y-4 ml-0 md:ml-12">
          {/* Store credit */}
          <div className="p-4 rounded-md bg-bg/40 border border-divider">
            <Toggle checked={shopSettings.allowStoreCredit} onChange={(v) => updateShopSettings({ allowStoreCredit: v })}
              label="Allow Store Credit refunds"
              description="Let customers choose store credit — issued instantly, retains revenue." />
            {shopSettings.allowStoreCredit && (
              <div className="mt-3 pl-12 space-y-3 animate-fadeIn">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-[12.5px] text-muted shrink-0">Store credit bonus</label>
                  <div className="flex items-center gap-1.5">
                    <input type="number" min={0} max={50}
                      value={shopSettings.storeCreditBonusPercent}
                      onChange={e => updateShopSettings({ storeCreditBonusPercent: Math.max(0, Math.min(50, +e.target.value || 0)) })}
                      placeholder="10"
                      className="w-20 h-8 px-3 text-[13px] rounded-md bg-bg border border-border text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 text-center tabular-nums" />
                    <span className="text-[12.5px] text-muted">% bonus</span>
                  </div>
                  <span className="text-[11.5px] text-faint">0 = no bonus</span>
                </div>
                <Toggle checked={shopSettings.incentivizeStoreCredit}
                  onChange={(v) => updateShopSettings({ incentivizeStoreCredit: v })}
                  label="Incentivize store credit in the portal"
                  description="Show a badge and the bonus percentage on the store-credit option." />
                {shopSettings.incentivizeStoreCredit && shopSettings.storeCreditBonusPercent > 0 && (
                  <div className="px-3 py-2 rounded-md text-[12px] flex items-center gap-2 animate-fadeIn"
                    style={{ background: 'rgba(108,99,255,0.10)', color: '#8B85FF' }}>
                    <Icon name="Sparkles" size={12} />
                    Customers will see <strong className="text-ink">+{shopSettings.storeCreditBonusPercent}% bonus credit</strong> on the store-credit option.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Exchanges */}
          <div className="p-4 rounded-md bg-bg/40 border border-divider">
            <Toggle checked={shopSettings.allowExchanges} onChange={(v) => updateShopSettings({ allowExchanges: v })}
              label="Allow Exchanges"
              description="Let customers swap an item for another size, color, or product." />
            {shopSettings.allowExchanges && (
              <div className="mt-3 pl-12 space-y-2 animate-fadeIn">
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-[12.5px] text-muted shrink-0">Exchange window</label>
                  <span className="text-[12.5px] text-ink">Same as return window ({returnWindow} days)</span>
                </div>
                <div className="text-[11.5px] text-muted leading-relaxed">
                  Customers will be able to select <span className="text-ink">Exchange</span> as their refund type in the portal.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pb-6"><SaveBar /></div>
    </div>
  );
}

// ---- Reasons tab ----
function ReasonsTab() {
  const [reasons, setReasons] = useState(DEFAULT_REASONS);
  const [newLabel, setNewLabel] = useState('');
  const toast = useToast();
  const addReason = () => {
    if (!newLabel.trim()) return;
    setReasons(r => [...r, { id: Date.now(), label: newLabel.trim(), enabled: true }]);
    setNewLabel('');
    toast({ kind: 'success', title: 'Reason added' });
  };
  const toggle = (id) => setReasons(rs => rs.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  const del = (id) => { setReasons(rs => rs.filter(r => r.id !== id)); toast({ kind: 'info', title: 'Reason removed' }); };

  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <div className="text-[14px] font-semibold text-ink">Return reasons</div>
          <div className="text-[12.5px] text-muted mt-1">Customers pick one of these when filing a return.</div>
        </div>
      </div>

      <div className="space-y-1.5">
        {reasons.map(r => (
          <div key={r.id} className="flex items-center gap-3 py-2.5 px-3 rounded-md bg-bg/30 border border-divider group">
            <Icon name="GripVertical" size={14} className="text-faint cursor-grab" />
            <div className={`flex-1 text-[13.5px] ${r.enabled ? 'text-ink' : 'text-faint line-through'}`}>{r.label}</div>
            <Toggle checked={r.enabled} onChange={() => toggle(r.id)} />
            <button onClick={() => del(r.id)} className="p-1.5 rounded text-faint hover:text-danger hover:bg-danger/10 transition opacity-0 group-hover:opacity-100">
              <Icon name="Trash2" size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-5 border-t border-divider flex items-center gap-2">
        <Input value={newLabel} onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addReason()}
          placeholder="e.g. Item not as pictured" className="flex-1" />
        <Btn variant="secondary" icon="Plus" onClick={addReason} disabled={!newLabel.trim()}>Add Custom Reason</Btn>
      </div>
    </div>
  );
}

// ---- Emails tab ----
function EmailsTab() {
  const [template, setTemplate] = useState('Request Received');
  const [subject, setSubject] = useState(EMAIL_TEMPLATES['Request Received'].subject);
  const [body, setBody] = useState(EMAIL_TEMPLATES['Request Received'].body);

  useEffect(() => {
    setSubject(EMAIL_TEMPLATES[template].subject);
    setBody(EMAIL_TEMPLATES[template].body);
  }, [template]);

  // Render preview by replacing variables
  const fill = (s) => s
    .replace(/\{\{customer_name\}\}/g, 'Sarah')
    .replace(/\{\{rma_number\}\}/g, 'RMA-2026-000012')
    .replace(/\{\{order_number\}\}/g, '#1089')
    .replace(/\{\{item_count\}\}/g, '2')
    .replace(/\{\{refund_amount\}\}/g, '$83.00')
    .replace(/\{\{rejection_reason\}\}/g, 'Outside 30-day return window');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 bg-surface border border-border rounded-lg p-6">
        <label className="text-[12px] font-medium text-muted block mb-1.5">Template</label>
        <Select value={template} onChange={setTemplate}
          options={['Request Received', 'Approved', 'Rejected', 'Refunded']} />

        <label className="text-[12px] font-medium text-muted block mt-5 mb-1.5">Subject line</label>
        <Input value={subject} onChange={e => setSubject(e.target.value)} />

        <label className="text-[12px] font-medium text-muted block mt-5 mb-1.5">Body</label>
        <Textarea value={body} onChange={e => setBody(e.target.value)} rows={11} className="font-mono text-[12.5px]" />

        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span className="text-faint mr-1">Variables:</span>
          {['{{customer_name}}', '{{rma_number}}', '{{order_number}}', '{{refund_amount}}'].map(v => (
            <span key={v} className="px-1.5 py-0.5 rounded bg-accent/10 text-accent2 font-mono">{v}</span>
          ))}
        </div>

        <SaveBar />
      </div>

      {/* Preview */}
      <div className="lg:col-span-2">
        <div className="text-[12px] font-medium text-muted mb-2 flex items-center gap-1.5"><Icon name="Eye" size={12} /> Live preview</div>
        <div className="bg-[#f6f6f8] rounded-lg border border-border shadow-pop overflow-hidden">
          <div className="bg-white px-5 py-3 border-b border-[#e6e6ec] flex items-center gap-2">
            <div className="w-7 h-7 rounded grid place-content-center text-white text-[11px] font-bold"
              style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)' }}>A</div>
            <div>
              <div className="text-[12.5px] font-semibold text-[#111]">Acme Store</div>
              <div className="text-[10.5px] text-[#666]">to sarah.johnson@email.com</div>
            </div>
          </div>
          <div className="px-5 py-4 bg-white">
            <div className="text-[14px] font-semibold text-[#111] mb-3">{fill(subject)}</div>
            <pre className="text-[12.5px] text-[#333] whitespace-pre-wrap font-sans leading-relaxed">{fill(body)}</pre>
            <div className="mt-4 pt-4 border-t border-[#e6e6ec]">
              <button className="w-full h-9 rounded text-[12.5px] font-semibold text-white"
                style={{ background: '#6C63FF' }}>View return status</button>
            </div>
          </div>
          <div className="bg-[#f1f1f5] px-5 py-2.5 text-[10.5px] text-[#888] text-center">Sent by TrackBack · Acme Store</div>
        </div>
      </div>
    </div>
  );
}

// ---- Branding tab ----
function BrandingTab({ onOpenPortal }) {
  const [color, setColor] = useState('#6C63FF');
  const [logoName, setLogoName] = useState('');
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 bg-surface border border-border rounded-lg p-6">
        <SettingRow label="Store logo" hint="Shown on the customer return portal and emails. PNG or SVG, 256×256.">
          <label className="block border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-accent/50 hover:bg-accent/[0.03] transition group">
            <input type="file" className="hidden" accept="image/*" onChange={e => setLogoName(e.target.files?.[0]?.name || '')} />
            {logoName ? (
              <div className="flex items-center justify-center gap-2 text-[13px] text-ink">
                <Icon name="ImagePlus" size={16} className="text-ok" />
                <span>{logoName}</span>
                <button onClick={(e) => { e.preventDefault(); setLogoName(''); }} className="text-faint hover:text-danger ml-2"><Icon name="X" size={12} /></button>
              </div>
            ) : (
              <>
                <div className="w-10 h-10 rounded-md bg-bg/60 grid place-content-center mx-auto mb-2 group-hover:bg-accent/15 transition">
                  <Icon name="Upload" size={16} className="text-muted group-hover:text-accent2 transition" />
                </div>
                <div className="text-[13px] text-ink font-medium">Drop your logo or click to browse</div>
                <div className="text-[11.5px] text-faint mt-1">PNG, SVG · up to 2MB</div>
              </>
            )}
          </label>
        </SettingRow>

        <SettingRow label="Brand color" hint="Used for buttons and accents on the customer portal.">
          <div className="flex items-center gap-3">
            <label className="relative w-10 h-10 rounded-md border border-border cursor-pointer overflow-hidden" style={{ background: color }}>
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
            <Input value={color} onChange={e => setColor(e.target.value)} className="w-32 font-mono" />
            <div className="flex gap-1.5">
              {['#6C63FF', '#3B82F6', '#22C55E', '#EF4444', '#F59E0B', '#0F1117'].map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-md border-2 transition ${color.toLowerCase() === c.toLowerCase() ? 'border-ink' : 'border-border hover:border-muted'}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
        </SettingRow>

        <div className="pt-2">
          <Btn variant="secondary" icon="ExternalLink" onClick={onOpenPortal}>Preview Portal</Btn>
        </div>

        <SaveBar />
      </div>

      {/* Mini portal preview */}
      <div className="lg:col-span-2">
        <div className="text-[12px] font-medium text-muted mb-2 flex items-center gap-1.5"><Icon name="Eye" size={12} /> Customer portal preview</div>
        <div className="rounded-lg overflow-hidden border border-border shadow-pop">
          {/* Window chrome */}
          <div className="bg-[#1a1d27] px-3 py-2 flex items-center gap-1.5 border-b border-border">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]"></span>
            <div className="flex-1 mx-3 h-5 rounded text-[10px] bg-bg text-faint flex items-center px-2">acmestore.com/returns</div>
          </div>
          <div className="bg-[#F8FAFC] text-[#111] px-5 py-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-7 h-7 rounded grid place-content-center text-white text-[11px] font-bold" style={{ background: color }}>A</div>
              <div className="text-[13px] font-semibold">Acme Store · Return Center</div>
            </div>
            <div className="text-[11px] uppercase tracking-wider text-[#888] mb-1.5">Step 1 of 4</div>
            <div className="text-[16px] font-semibold mb-3">Find your order</div>
            <div className="space-y-2 mb-4">
              <div className="h-9 rounded border border-[#d8dce5] bg-white px-3 text-[12px] text-[#aaa] flex items-center">#1089</div>
              <div className="h-9 rounded border border-[#d8dce5] bg-white px-3 text-[12px] text-[#aaa] flex items-center">your@email.com</div>
            </div>
            <button className="w-full h-10 rounded text-[13px] font-semibold text-white transition" style={{ background: color }}>
              Find Order
            </button>
            <div className="mt-4 text-[10.5px] text-[#888] text-center">Powered by TrackBack</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Policy tab ----
function PolicyTab() {
  const [policy, setPolicy] = useState(`Acme Store Return Policy

We want you to love what you buy. If something isn't quite right, here's how it works:

· Returns are accepted within 30 days of delivery.
· Items must be unworn, unwashed, and in original packaging.
· Final-sale items (marked at checkout) cannot be returned.
· Refunds are issued to the original payment method within 3–5 business days of receiving the returned item.

To start a return, head to acmestore.com/returns with your order number and email. We'll email a prepaid label and you can drop it off at any USPS location.

Questions? Email returns@acmestore.com — we usually reply within 1 business day.`);

  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
        <div>
          <div className="text-[14px] font-semibold text-ink">Return policy</div>
          <div className="text-[12.5px] text-muted mt-1">Shown on the customer portal and linked in confirmation emails.</div>
        </div>
        <div className="text-[11.5px] text-muted flex items-center gap-1.5">
          <Icon name="Eye" size={12} /> {policy.length} characters · {policy.split(/\s+/).filter(Boolean).length} words
        </div>
      </div>
      <Textarea value={policy} onChange={e => setPolicy(e.target.value)} rows={14} className="leading-relaxed" />
      <SaveBar />
    </div>
  );
}

window.SettingsPage = SettingsPage;
