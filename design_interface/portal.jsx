// ---------- Customer Portal (light theme) ----------
function PortalPage({ onExit, shopSettings = DEFAULT_SHOP_SETTINGS }) {
  const [step, setStep] = useState(1);
  const [orderNum, setOrderNum] = useState('');
  const [email, setEmail] = useState('');
  const [selectedItems, setSelectedItems] = useState({}); // id -> { qty }
  const [reasons, setReasons] = useState({});  // id -> reason
  const [notes, setNotes] = useState({});  // id -> note
  const [refundType, setRefundType] = useState('ORIGINAL_PAYMENT');
  const [submitted, setSubmitted] = useState(false);

  // Build the list of available refund options based on shop settings
  const availableRefundTypes = useMemo(() => {
    const list = ['ORIGINAL_PAYMENT'];
    if (shopSettings.allowStoreCredit) list.push('STORE_CREDIT');
    if (shopSettings.allowExchanges) list.push('EXCHANGE');
    return list;
  }, [shopSettings.allowStoreCredit, shopSettings.allowExchanges]);

  // Refund Type step is conditional: only show if >1 option exists
  const showRefundStep = availableRefundTypes.length > 1;
  const STEPS = showRefundStep
    ? ['Find Order', 'Select Items', 'Reason', 'Refund Type', 'Confirm']
    : ['Find Order', 'Select Items', 'Reason', 'Confirm'];

  const confirmStep = STEPS.length;          // last step index
  const refundStep = showRefundStep ? 4 : null;

  const itemsList = Object.entries(selectedItems).filter(([_, v]) => v.qty > 0)
    .map(([id]) => PORTAL_ORDER.items.find(i => i.id === id));

  const totalRefund = itemsList.reduce((s, it) => s + (it.price * (selectedItems[it.id]?.qty || 0)), 0);

  const canContinue = {
    1: orderNum.trim() && email.trim().includes('@'),
    2: itemsList.length > 0,
    3: itemsList.every(i => reasons[i.id]),
    4: !!refundType, // only matters if showRefundStep
  };

  const go = (n) => setStep(n);
  // Advance from a given step to the next one in the flow
  const nextFrom = (current) => {
    if (current === 3) return showRefundStep ? 4 : confirmStep;
    if (current === 4) return confirmStep;
    return current + 1;
  };
  const prevFrom = (current) => {
    if (current === confirmStep) return showRefundStep ? 4 : 3;
    if (current === 4) return 3;
    return current - 1;
  };

  if (submitted) {
    return <PortalShell onExit={onExit}><PortalConfirmation onReset={() => { setSubmitted(false); setStep(1); setOrderNum(''); setEmail(''); setSelectedItems({}); setReasons({}); setNotes({}); setRefundType('ORIGINAL_PAYMENT'); }} /></PortalShell>;
  }

  // Map abstract step number to a stepper position (1..STEPS.length)
  const stepperCurrent = step === confirmStep ? STEPS.length : step;

  return (
    <PortalShell onExit={onExit}>
      {/* Stepper */}
      <Stepper steps={STEPS} current={stepperCurrent} onJump={(i) => {
        const target = i + 1;
        // Allow jumping back to completed steps
        if (target < stepperCurrent) {
          // Resolve real step from stepper position
          if (target === STEPS.length) go(confirmStep);
          else go(target);
        }
      }} />

      <div className="bg-white rounded-2xl border border-[#e6e6ec] shadow-[0_4px_24px_rgba(15,17,23,0.06)] p-6 sm:p-8 mt-6">
        {step === 1 && (
          <StepFindOrder orderNum={orderNum} setOrderNum={setOrderNum} email={email} setEmail={setEmail}
            onNext={() => canContinue[1] && go(2)} canContinue={canContinue[1]} />
        )}
        {step === 2 && (
          <StepSelectItems selectedItems={selectedItems} setSelectedItems={setSelectedItems}
            onBack={() => go(1)} onNext={() => canContinue[2] && go(3)} canContinue={canContinue[2]} />
        )}
        {step === 3 && (
          <StepReasons itemsList={itemsList} reasons={reasons} setReasons={setReasons}
            notes={notes} setNotes={setNotes}
            totalSteps={STEPS.length}
            onBack={() => go(prevFrom(3))} onNext={() => canContinue[3] && go(nextFrom(3))} canContinue={canContinue[3]} />
        )}
        {step === 4 && showRefundStep && (
          <StepRefundType
            availableRefundTypes={availableRefundTypes}
            refundType={refundType} setRefundType={setRefundType}
            totalRefund={totalRefund}
            shopSettings={shopSettings}
            totalSteps={STEPS.length}
            onBack={() => go(prevFrom(4))} onNext={() => canContinue[4] && go(nextFrom(4))} canContinue={canContinue[4]} />
        )}
        {step === confirmStep && (
          <StepConfirm itemsList={itemsList} selectedItems={selectedItems} reasons={reasons} notes={notes}
            totalRefund={totalRefund} orderNum={orderNum} email={email}
            refundType={refundType} shopSettings={shopSettings}
            totalSteps={STEPS.length}
            onBack={() => go(prevFrom(confirmStep))} onSubmit={() => setSubmitted(true)} />
        )}
      </div>

      <div className="text-center text-[12px] text-[#888] mt-6">
        Need help? Email <a className="underline" style={{ color: '#6C63FF' }}>support@acmestore.com</a>
        <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-[#aaa]">
          <Icon name="Lock" size={11} /> Secured by TrackBack
        </div>
      </div>
    </PortalShell>
  );
}

function PortalShell({ children, onExit }) {
  return (
    <div className="min-h-screen w-full" style={{ background: '#F8FAFC', color: '#0f1117' }}>
      {/* Top bar */}
      <header className="bg-white border-b border-[#e6e6ec]">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-md grid place-content-center text-white font-bold"
              style={{ background: 'linear-gradient(135deg,#6C63FF,#8B5CF6)', boxShadow: '0 4px 14px rgba(108,99,255,0.35)' }}>A</div>
            <div>
              <div className="text-[15px] font-semibold leading-tight">Acme Store</div>
              <div className="text-[11.5px] text-[#888]">Return Center</div>
            </div>
          </div>
          <button onClick={onExit} className="text-[12.5px] text-[#666] hover:text-[#111] flex items-center gap-1.5">
            <Icon name="ArrowLeft" size={13} /> Back to admin
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-10">{children}</main>
    </div>
  );
}

function Stepper({ steps, current, onJump }) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const idx = i + 1;
        const isDone = idx < current;
        const isCurr = idx === current;
        return (
          <React.Fragment key={s}>
            <button onClick={() => onJump(i)} className="flex items-center gap-2 group">
              <div className={`w-7 h-7 rounded-full grid place-content-center text-[12px] font-semibold transition ${isDone ? 'text-white' : isCurr ? 'text-white' : 'text-[#aaa]'
                }`} style={{
                  background: isDone ? '#6C63FF' : isCurr ? '#0f1117' : '#fff',
                  border: isDone ? 'none' : isCurr ? 'none' : '1.5px solid #d8dce5'
                }}>
                {isDone ? <Icon name="Check" size={13} strokeWidth={3} /> : idx}
              </div>
              <span className={`text-[12.5px] font-medium hidden sm:inline ${isCurr ? 'text-[#0f1117]' : isDone ? 'text-[#0f1117]' : 'text-[#aaa]'}`}>{s}</span>
            </button>
            {i < steps.length - 1 && (
              <div className="flex-1 h-px" style={{ background: idx < current ? '#6C63FF' : '#e6e6ec' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function PortalInput({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div>
      <label className="block text-[12.5px] font-medium text-[#444] mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-11 px-3.5 rounded-lg border border-[#d8dce5] bg-white text-[14px] text-[#111] placeholder:text-[#aaa] focus:outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/15 transition" />
    </div>
  );
}

function PortalBtn({ variant = 'primary', children, full, onClick, disabled, icon, iconRight }) {
  const base = 'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg text-[13.5px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const map = {
    primary: 'text-white shadow-[0_4px_14px_rgba(108,99,255,0.3)] hover:shadow-[0_6px_20px_rgba(108,99,255,0.4)]',
    ghost: 'text-[#666] hover:text-[#111] bg-transparent hover:bg-[#f0f0f5]',
    outline: 'border border-[#d8dce5] bg-white text-[#111] hover:bg-[#f8fafc]',
  };
  const style = variant === 'primary' ? { background: '#6C63FF' } : {};
  return (
    <button onClick={onClick} disabled={disabled} style={style}
      className={`${base} ${map[variant]} ${full ? 'w-full' : ''}`}>
      {icon && <Icon name={icon} size={14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
}

function StepFindOrder({ orderNum, setOrderNum, email, setEmail, onNext, canContinue }) {
  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wider text-[#888] mb-1.5 font-semibold">Step 1</div>
      <h2 className="text-[22px] font-bold text-[#0f1117] tracking-tight">Find your order</h2>
      <p className="text-[13.5px] text-[#666] mt-1.5 leading-relaxed">
        Enter your order number and the email used at checkout. We'll pull it up in a moment.
      </p>

      <div className="mt-6 space-y-4 max-w-md">
        <PortalInput label="Order number" value={orderNum} onChange={setOrderNum} placeholder="#1089" />
        <PortalInput label="Email address" value={email} onChange={setEmail} placeholder="your@email.com" type="email" />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <a className="text-[12.5px] text-[#6C63FF] hover:underline cursor-pointer">Can't find your order?</a>
        <PortalBtn onClick={onNext} disabled={!canContinue} iconRight="ArrowRight">Find Order</PortalBtn>
      </div>
    </div>
  );
}

function StepSelectItems({ selectedItems, setSelectedItems, onBack, onNext, canContinue }) {
  const toggleItem = (id) => {
    setSelectedItems(s => {
      const next = { ...s };
      if (next[id]?.qty > 0) delete next[id];
      else next[id] = { qty: 1 };
      return next;
    });
  };
  const setQty = (id, qty) => setSelectedItems(s => ({ ...s, [id]: { qty: Math.max(1, qty) } }));

  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wider text-[#888] mb-1.5 font-semibold">Step 2</div>
      <h2 className="text-[22px] font-bold text-[#0f1117] tracking-tight">Select items to return</h2>
      <p className="text-[13.5px] text-[#666] mt-1.5">
        From order <span className="font-semibold text-[#0f1117]">#1089</span> · placed April 28, 2026.
      </p>

      <div className="mt-6 space-y-2">
        {PORTAL_ORDER.items.map(item => {
          const sel = !!selectedItems[item.id];
          const qty = selectedItems[item.id]?.qty || 1;
          return (
            <label key={item.id}
              className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition ${sel ? 'border-[#6C63FF] bg-[#6C63FF]/[0.04]' : 'border-[#e6e6ec] hover:border-[#cfd3df]'
                }`}>
              <input type="checkbox" checked={sel} onChange={() => toggleItem(item.id)} className="sr-only" />
              <div className={`w-5 h-5 rounded-md grid place-content-center shrink-0 transition ${sel ? 'bg-[#6C63FF]' : 'bg-white border-2 border-[#d8dce5]'
                }`}>
                {sel && <Icon name="Check" size={12} className="text-white" strokeWidth={3.5} />}
              </div>
              <div className="w-16 h-16 rounded-lg grid place-content-center shrink-0 border border-[#e6e6ec]"
                style={{ background: item.color }}>
                <Icon name="Shirt" size={22} className="text-black/30" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-[#0f1117]">{item.name}</div>
                <div className="text-[12.5px] text-[#666] mt-0.5">{item.variant}</div>
              </div>
              {sel && (
                <div className="flex items-center gap-1 bg-white rounded-md border border-[#e6e6ec] overflow-hidden" onClick={e => e.preventDefault()}>
                  <button onClick={() => setQty(item.id, qty - 1)} className="w-7 h-8 text-[#666] hover:bg-[#f0f0f5]">−</button>
                  <span className="w-6 text-center text-[13px] font-semibold tabular-nums">{qty}</span>
                  <button onClick={() => setQty(item.id, qty + 1)} className="w-7 h-8 text-[#666] hover:bg-[#f0f0f5]">+</button>
                </div>
              )}
              <div className="text-[14px] font-semibold text-[#0f1117] tabular-nums w-16 text-right">${item.price.toFixed(2)}</div>
            </label>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <PortalBtn variant="ghost" onClick={onBack} icon="ArrowLeft">Back</PortalBtn>
        <PortalBtn onClick={onNext} disabled={!canContinue} iconRight="ArrowRight">Continue</PortalBtn>
      </div>
    </div>
  );
}

function StepReasons({ itemsList, reasons, setReasons, notes, setNotes, onBack, onNext, canContinue, totalSteps = 4 }) {
  const REASON_OPTS = DEFAULT_REASONS.filter(r => r.enabled).map(r => r.label);
  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wider text-[#888] mb-1.5 font-semibold">Step 3</div>
      <h2 className="text-[22px] font-bold text-[#0f1117] tracking-tight">Tell us why</h2>
      <p className="text-[13.5px] text-[#666] mt-1.5">
        Help us make it right. Pick a reason for each item.
      </p>

      <div className="mt-6 space-y-4">
        {itemsList.map(item => (
          <div key={item.id} className="p-4 rounded-xl border border-[#e6e6ec] bg-[#fafbfc]">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-md grid place-content-center shrink-0 border border-[#e6e6ec]" style={{ background: item.color }}>
                <Icon name="Shirt" size={14} className="text-black/30" />
              </div>
              <div className="flex-1">
                <div className="text-[13.5px] font-semibold text-[#0f1117]">{item.name}</div>
                <div className="text-[12px] text-[#666]">{item.variant}</div>
              </div>
            </div>

            <label className="block text-[12px] font-medium text-[#444] mb-1.5">Select reason</label>
            <div className="relative mb-3">
              <select value={reasons[item.id] || ''} onChange={e => setReasons(r => ({ ...r, [item.id]: e.target.value }))}
                className="w-full h-11 pl-3.5 pr-9 rounded-lg border border-[#d8dce5] bg-white text-[13.5px] appearance-none focus:outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/15 transition">
                <option value="" disabled>Choose a reason…</option>
                {REASON_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#888]">
                <Icon name="ChevronDown" size={14} />
              </div>
            </div>

            <label className="block text-[12px] font-medium text-[#444] mb-1.5">Additional notes <span className="text-[#aaa] font-normal">(optional)</span></label>
            <textarea rows={2} value={notes[item.id] || ''} onChange={e => setNotes(n => ({ ...n, [item.id]: e.target.value }))}
              placeholder="Anything else we should know?"
              className="w-full px-3.5 py-2.5 rounded-lg border border-[#d8dce5] bg-white text-[13px] resize-none focus:outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/15 transition" />
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <PortalBtn variant="ghost" onClick={onBack} icon="ArrowLeft">Back</PortalBtn>
        <PortalBtn onClick={onNext} disabled={!canContinue} iconRight="ArrowRight">Continue</PortalBtn>
      </div>
    </div>
  );
}

function StepRefundType({ availableRefundTypes, refundType, setRefundType, totalRefund, shopSettings, onBack, onNext, canContinue, totalSteps = 5 }) {
  const showBonus = shopSettings.incentivizeStoreCredit && shopSettings.storeCreditBonusPercent > 0;
  const bonusPct = shopSettings.storeCreditBonusPercent;
  const bonusAmount = totalRefund * (bonusPct / 100);

  const OPTIONS = {
    ORIGINAL_PAYMENT: {
      icon: 'CreditCard',
      title: 'Refund to original payment',
      desc: 'Refunded to your original payment method within 5–10 business days.',
      badge: null,
      foot: null,
    },
    STORE_CREDIT: {
      icon: 'Gift',
      title: 'Store credit',
      desc: 'Get store credit to use on your next purchase. Available instantly.',
      badge: { label: '⚡ Instant', kind: 'accent' },
      bonusBadge: showBonus ? { label: `+${bonusPct}% bonus credit`, amount: `Get $${(totalRefund + bonusAmount).toFixed(2)} instead of $${totalRefund.toFixed(2)}` } : null,
    },
    EXCHANGE: {
      icon: 'RefreshCw',
      title: 'Exchange for another item',
      desc: "We'll send you a replacement once we receive your return.",
      badge: { label: '🔄 Recommended', kind: 'info' },
      foot: "You'll select your replacement item after submitting.",
    },
  };

  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wider text-[#888] mb-1.5 font-semibold">Step 4 of {totalSteps}</div>
      <h2 className="text-[22px] font-bold text-[#0f1117] tracking-tight">How would you like to be refunded?</h2>
      <p className="text-[13.5px] text-[#666] mt-1.5">Choose the option that works best for you.</p>

      <div className="mt-6 space-y-3" role="radiogroup" aria-label="Refund method">
        {availableRefundTypes.map(key => {
          const opt = OPTIONS[key];
          const selected = refundType === key;
          return (
            <button key={key}
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              onClick={() => setRefundType(key)}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setRefundType(key); } }}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-150 relative group cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-[#6C63FF]/20 ${selected
                  ? 'border-[#6C63FF] bg-[#6C63FF]/[0.04]'
                  : 'border-[#e6e6ec] bg-white hover:border-[#cfd3df]'
                }`}>
              {/* Selected check */}
              {selected && (
                <div className="absolute top-3 right-3 w-6 h-6 rounded-full grid place-content-center shadow-[0_2px_8px_rgba(108,99,255,0.4)]"
                  style={{ background: '#6C63FF' }}>
                  <Icon name="Check" size={13} strokeWidth={3.5} className="text-white" />
                </div>
              )}

              <div className="flex items-start gap-4">
                <div className={`w-11 h-11 rounded-lg grid place-content-center shrink-0 transition-colors ${selected ? 'text-white' : 'text-[#444]'
                  }`} style={{ background: selected ? '#6C63FF' : '#f0f0f5' }}>
                  <Icon name={opt.icon} size={18} />
                </div>

                <div className="flex-1 min-w-0 pr-8">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14.5px] font-bold text-[#0f1117]">{opt.title}</span>
                    {opt.badge && (
                      <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full tracking-wide"
                        style={opt.badge.kind === 'accent'
                          ? { background: '#6C63FF', color: 'white' }
                          : { background: '#3B82F615', color: '#3B82F6' }}>
                        {opt.badge.label}
                      </span>
                    )}
                    {key === 'STORE_CREDIT' && opt.bonusBadge && (
                      <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: 'linear-gradient(90deg,#F59E0B,#EF4444)', color: 'white' }}>
                        {opt.bonusBadge.label}
                      </span>
                    )}
                  </div>
                  <div className="text-[12.5px] text-[#666] mt-1 leading-relaxed">{opt.desc}</div>
                  {key === 'STORE_CREDIT' && opt.bonusBadge && (
                    <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-semibold"
                      style={{ background: 'rgba(108,99,255,0.10)', color: '#6C63FF' }}>
                      <Icon name="Sparkles" size={11} /> {opt.bonusBadge.amount}
                    </div>
                  )}
                  {key === 'EXCHANGE' && opt.foot && (
                    <div className="mt-2 text-[11.5px] text-[#888] flex items-center gap-1.5">
                      <Icon name="Info" size={11} /> {opt.foot}
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <PortalBtn variant="ghost" onClick={onBack} icon="ArrowLeft">Back</PortalBtn>
        <PortalBtn onClick={onNext} disabled={!canContinue} iconRight="ArrowRight">Continue</PortalBtn>
      </div>
    </div>
  );
}

function StepConfirm({ itemsList, selectedItems, reasons, notes, totalRefund, orderNum, email, onBack, onSubmit, refundType = 'ORIGINAL_PAYMENT', shopSettings = DEFAULT_SHOP_SETTINGS, totalSteps = 4 }) {
  const meta = REFUND_TYPES[refundType];
  const showBonus = refundType === 'STORE_CREDIT' && shopSettings.incentivizeStoreCredit && shopSettings.storeCreditBonusPercent > 0;
  const bonusAmount = showBonus ? totalRefund * (shopSettings.storeCreditBonusPercent / 100) : 0;
  const creditTotal = totalRefund + bonusAmount;

  return (
    <div>
      <div className="text-[11.5px] uppercase tracking-wider text-[#888] mb-1.5 font-semibold">Step {totalSteps}</div>
      <h2 className="text-[22px] font-bold text-[#0f1117] tracking-tight">Review & submit</h2>
      <p className="text-[13.5px] text-[#666] mt-1.5">One last look before we send this to Acme Store.</p>

      <div className="mt-6 space-y-3">
        {itemsList.map(item => (
          <div key={item.id} className="flex gap-4 p-4 rounded-xl border border-[#e6e6ec] bg-white">
            <div className="w-14 h-14 rounded-md grid place-content-center shrink-0 border border-[#e6e6ec]" style={{ background: item.color }}>
              <Icon name="Shirt" size={18} className="text-black/30" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between gap-3">
                <div className="text-[13.5px] font-semibold text-[#0f1117]">{item.name}</div>
                <div className="text-[13.5px] font-semibold tabular-nums">${(item.price * selectedItems[item.id].qty).toFixed(2)}</div>
              </div>
              <div className="text-[12px] text-[#666] mt-0.5">{item.variant} · Qty {selectedItems[item.id].qty}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11.5px]">
                <span className="px-2 py-0.5 rounded bg-[#f0f0f5] text-[#444]">{reasons[item.id]}</span>
                {notes[item.id] && <span className="px-2 py-0.5 rounded bg-[#fff7e6] text-[#a07300] italic">"{notes[item.id]}"</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 p-4 rounded-xl bg-[#fafbfc] border border-[#e6e6ec]">
        <div className="flex justify-between text-[13px] text-[#666]"><span>Subtotal</span><span className="tabular-nums">${totalRefund.toFixed(2)}</span></div>
        <div className="flex justify-between text-[13px] text-[#666] mt-1"><span>Restocking fee</span><span className="tabular-nums">−$0.00</span></div>
        {showBonus && (
          <div className="flex justify-between text-[13px] mt-1" style={{ color: '#6C63FF' }}>
            <span className="flex items-center gap-1"><Icon name="Sparkles" size={11} /> Store credit bonus (+{shopSettings.storeCreditBonusPercent}%)</span>
            <span className="tabular-nums">+${bonusAmount.toFixed(2)}</span>
          </div>
        )}
        <div className="border-t border-[#e6e6ec] my-2.5"></div>
        <div className="flex justify-between text-[15px] font-bold text-[#0f1117]">
          <span>{refundType === 'EXCHANGE' ? 'Estimated value' : showBonus ? 'Total store credit' : 'Estimated refund'}</span>
          <span className="tabular-nums">${(showBonus ? creditTotal : totalRefund).toFixed(2)}</span>
        </div>

        {/* Refund method row */}
        <div className="mt-3 pt-3 border-t border-[#e6e6ec] flex items-center justify-between gap-3">
          <span className="text-[12px] text-[#666] font-medium">Refund method</span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-semibold"
            style={{ background: meta.bg, color: meta.color }}>
            <Icon name={meta.icon} size={12} />
            {refundType === 'ORIGINAL_PAYMENT' && 'Refund to original payment (5–10 days)'}
            {refundType === 'STORE_CREDIT' && `Store credit · $${(showBonus ? creditTotal : totalRefund).toFixed(2)}`}
            {refundType === 'EXCHANGE' && 'Exchange · item selection after submission'}
          </span>
        </div>
      </div>

      <div className="mt-5 p-4 rounded-xl border border-[#e6e6ec] bg-white flex gap-3">
        <div className="w-8 h-8 rounded-md grid place-content-center shrink-0" style={{ background: '#6C63FF15', color: '#6C63FF' }}>
          <Icon name="Truck" size={16} />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-[#0f1117]">Ship to</div>
          <div className="text-[12.5px] text-[#666] mt-0.5 leading-relaxed">
            Acme Store — Returns<br />
            1450 Mission St, Suite 200<br />
            San Francisco, CA 94103
          </div>
          <div className="text-[11.5px] text-[#6C63FF] mt-1.5">A prepaid label will be emailed to {email || 'you'}.</div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <PortalBtn variant="ghost" onClick={onBack} icon="ArrowLeft">Back</PortalBtn>
        <PortalBtn onClick={onSubmit} full={false} icon="CircleCheck">Submit Return Request</PortalBtn>
      </div>
    </div>
  );
}

function PortalConfirmation({ onReset }) {
  return (
    <div className="text-center max-w-md mx-auto py-6">
      <div className="w-16 h-16 rounded-full grid place-content-center mx-auto mb-4 relative" style={{ background: '#22C55E15' }}>
        <div className="absolute inset-0 rounded-full animate-ping" style={{ background: '#22C55E22' }} />
        <Icon name="Check" size={28} strokeWidth={3} style={{ color: '#22C55E' }} />
      </div>
      <h2 className="text-[24px] font-bold text-[#0f1117] tracking-tight">Your return is on its way</h2>
      <p className="text-[13.5px] text-[#666] mt-2 leading-relaxed">
        We've sent the details to Acme Store. You'll get a confirmation email shortly with your prepaid label.
      </p>

      <div className="mt-6 p-5 rounded-xl bg-white border border-[#e6e6ec] text-left">
        <div className="text-[11.5px] uppercase tracking-wider text-[#888] font-semibold">Your RMA</div>
        <div className="text-[20px] font-bold text-[#0f1117] font-mono mt-1">RMA-2026-000013</div>
        <div className="mt-3 pt-3 border-t border-[#e6e6ec] space-y-2 text-[12.5px]">
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full grid place-content-center shrink-0 text-white text-[10px] font-bold" style={{ background: '#6C63FF' }}>1</div>
            <div className="text-[#444]">Watch your inbox — your prepaid shipping label arrives within a few minutes.</div>
          </div>
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full grid place-content-center shrink-0 text-white text-[10px] font-bold" style={{ background: '#6C63FF' }}>2</div>
            <div className="text-[#444]">Print the label, pack your items, and drop the package at any USPS location.</div>
          </div>
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full grid place-content-center shrink-0 text-white text-[10px] font-bold" style={{ background: '#6C63FF' }}>3</div>
            <div className="text-[#444]">Once received, your refund is issued within 3–5 business days.</div>
          </div>
        </div>
      </div>

      <button onClick={onReset} className="mt-6 text-[13px] font-semibold" style={{ color: '#6C63FF' }}>
        Start another return
      </button>
    </div>
  );
}

window.PortalPage = PortalPage;
