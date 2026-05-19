// ---------- Mock data for TrackBack ----------
export const RETURNS = [
  {
    rma: 'RMA-2026-000012', order: '#1089', customer: 'Sarah Johnson', email: 'sarah.johnson@email.com', phone: '+1 (555) 234-5678', itemsCount: 2, items: [
      { id: 'p1', name: 'Classic White Tee', variant: 'Size L → Size M', qty: 1, price: 29.00, reason: 'Wrong size', note: 'Ordered L but fits like XL', color: '#6C63FF' },
      { id: 'p2', name: 'Black Joggers', variant: 'Size XL', qty: 1, price: 54.00, reason: 'Wrong size', note: '', color: '#222536' },
    ], reason: 'Wrong size', date: 'May 15', dateFull: 'May 15, 2026 at 14:32 UTC', orderDate: 'April 28, 2026', fulfilled: 'April 30, 2026', orderTotal: 127.50, status: 'PENDING', amount: 83.00, customerSince: 'March 2024', refundType: 'ORIGINAL_PAYMENT'
  },
  {
    rma: 'RMA-2026-000011', order: '#1087', customer: 'Marcus Lee', email: 'm.lee@email.com', phone: '+1 (555) 187-0102', itemsCount: 1, items: [
      { id: 'p3', name: 'Wool Beanie', variant: 'One size · Charcoal', qty: 1, price: 24.00, reason: 'Defective', note: 'Seam unraveling out of the box.', color: '#3a3e58' }
    ], reason: 'Defective', date: 'May 15', dateFull: 'May 15, 2026 at 09:18 UTC', orderDate: 'April 22, 2026', fulfilled: 'April 24, 2026', orderTotal: 64.00, status: 'PENDING', amount: 24.00, customerSince: 'Nov 2023', refundType: 'STORE_CREDIT', storeCreditBonus: 10
  },
  {
    rma: 'RMA-2026-000010', order: '#1082', customer: 'Emma Davis', email: 'emma.d@email.com', phone: '+1 (555) 612-9933', itemsCount: 3, items: [
      { id: 'p4', name: 'Linen Shirt', variant: 'Size M · Sand', qty: 1, price: 68.00, reason: 'Changed mind', note: '', color: '#d6c7a6' },
      { id: 'p5', name: 'Canvas Tote', variant: 'Natural', qty: 1, price: 32.00, reason: 'Changed mind', note: '', color: '#a89568' },
      { id: 'p6', name: 'Sterling Cuff', variant: 'Size S', qty: 1, price: 48.00, reason: 'Changed mind', note: '', color: '#bfc4d1' },
    ], reason: 'Changed mind', date: 'May 14', dateFull: 'May 14, 2026 at 16:04 UTC', orderDate: 'April 18, 2026', fulfilled: 'April 19, 2026', orderTotal: 148.00, status: 'APPROVED', amount: 148.00, customerSince: 'July 2024', refundType: 'EXCHANGE'
  },
  {
    rma: 'RMA-2026-000009', order: '#1078', customer: 'Liam Wilson', email: 'liam.wilson@email.com', phone: '+1 (555) 220-7741', itemsCount: 1, items: [
      { id: 'p7', name: 'Trail Cap', variant: 'One size · Olive', qty: 1, price: 22.00, reason: 'Wrong color', note: '', color: '#3d5a3b' }
    ], reason: 'Wrong color', date: 'May 13', dateFull: 'May 13, 2026 at 11:51 UTC', orderDate: 'April 02, 2026', fulfilled: 'April 03, 2026', orderTotal: 22.00, status: 'REFUNDED', amount: 22.00, customerSince: 'Feb 2025', refundType: 'STORE_CREDIT'
  },
  {
    rma: 'RMA-2026-000008', order: '#1071', customer: 'Olivia Brown', email: 'olivia.b@email.com', phone: '+1 (555) 308-1175', itemsCount: 2, items: [
      { id: 'p8', name: 'Cashmere Crew', variant: 'Size S · Camel', qty: 1, price: 142.00, reason: 'Quality issue', note: 'Pilled badly after one wear.', color: '#b58a55' },
      { id: 'p9', name: 'Silk Scarf', variant: 'One size', qty: 1, price: 58.00, reason: 'Quality issue', note: '', color: '#8c4d6d' },
    ], reason: 'Quality issue', date: 'May 12', dateFull: 'May 12, 2026 at 08:22 UTC', orderDate: 'March 30, 2026', fulfilled: 'April 01, 2026', orderTotal: 200.00, status: 'REJECTED', amount: 200.00, customerSince: 'Aug 2022', refundType: 'ORIGINAL_PAYMENT'
  },
  {
    rma: 'RMA-2026-000007', order: '#1065', customer: 'Noah Patel', email: 'noah.p@email.com', phone: '+1 (555) 401-8852', itemsCount: 1, items: [
      { id: 'p10', name: 'Slim Chinos', variant: 'W32 · Stone', qty: 1, price: 78.00, reason: 'Wrong size', note: '', color: '#a89878' }
    ], reason: 'Wrong size', date: 'May 11', dateFull: 'May 11, 2026 at 13:09 UTC', orderDate: 'March 28, 2026', fulfilled: 'March 29, 2026', orderTotal: 78.00, status: 'RECEIVED', amount: 78.00, customerSince: 'Jan 2024', refundType: 'ORIGINAL_PAYMENT'
  },
  {
    rma: 'RMA-2026-000006', order: '#1058', customer: 'Ava Martinez', email: 'ava.m@email.com', phone: '+1 (555) 119-2206', itemsCount: 1, items: [
      { id: 'p11', name: 'Leather Belt', variant: 'Size 32 · Brown', qty: 1, price: 64.00, reason: 'Defective', note: '', color: '#5a3a25' }
    ], reason: 'Defective', date: 'May 10', dateFull: 'May 10, 2026 at 19:44 UTC', orderDate: 'March 22, 2026', fulfilled: 'March 23, 2026', orderTotal: 64.00, status: 'REFUNDED', amount: 64.00, customerSince: 'May 2023', refundType: 'ORIGINAL_PAYMENT'
  },
  {
    rma: 'RMA-2026-000005', order: '#1052', customer: 'Ethan Cohen', email: 'ethan.c@email.com', phone: '+1 (555) 760-3318', itemsCount: 2, items: [
      { id: 'p12', name: 'Oxford Shirt', variant: 'Size L · White', qty: 1, price: 88.00, reason: 'Not as described', note: '', color: '#eaeaf0' },
      { id: 'p13', name: 'Wool Tie', variant: 'Navy', qty: 1, price: 38.00, reason: 'Not as described', note: '', color: '#1f2a44' },
    ], reason: 'Not as described', date: 'May 09', dateFull: 'May 09, 2026 at 10:11 UTC', orderDate: 'March 18, 2026', fulfilled: 'March 19, 2026', orderTotal: 126.00, status: 'APPROVED', amount: 126.00, customerSince: 'Sep 2024', refundType: 'ORIGINAL_PAYMENT'
  },
];

export const TOP_REASONS = [
  { name: 'Wrong size', pct: 38, count: 18, color: '#6C63FF' },
  { name: 'Defective', pct: 22, count: 10, color: '#EF4444' },
  { name: 'Changed mind', pct: 18, count: 8, color: '#F59E0B' },
  { name: 'Wrong color', pct: 12, count: 6, color: '#3B82F6' },
  { name: 'Other', pct: 10, count: 5, color: '#8B5CF6' },
];

export const TOP_PRODUCTS = [
  { name: 'Classic White Tee', count: 18 },
  { name: 'Black Joggers', count: 12 },
  { name: 'Slim Chinos', count: 9 },
  { name: 'Linen Shirt', count: 7 },
  { name: 'Cashmere Crew', count: 5 },
];

// 30 days of return counts
export const RETURNS_OVER_TIME = [
  1, 2, 1, 3, 2, 4, 2, 1, 3, 5, 4, 2, 3, 6, 4, 3, 2, 5, 7, 4, 3, 5, 8, 6, 4, 3, 5, 7, 5, 4
];

export const DEFAULT_REASONS = [
  { id: 1, label: 'Wrong size', enabled: true },
  { id: 2, label: 'Wrong color', enabled: true },
  { id: 3, label: 'Defective', enabled: true },
  { id: 4, label: 'Changed mind', enabled: true },
  { id: 5, label: 'Not as described', enabled: true },
  { id: 6, label: 'Quality issue', enabled: true },
  { id: 7, label: 'Arrived late', enabled: false },
  { id: 8, label: 'Other', enabled: true },
];

export const EMAIL_TEMPLATES = {
  'Request Received': {
    subject: 'We received your return request — {{rma_number}}',
    body: `Hi {{customer_name}},

Thanks for reaching out. We've received your return request for order {{order_number}}.

Your RMA: {{rma_number}}
Items: {{item_count}}

We typically review requests within 1 business day. You'll hear from us soon.

— Acme Store`,
  },
  'Approved': {
    subject: 'Your return is approved — ship it back',
    body: `Hi {{customer_name}},

Good news — we've approved your return.

Return shipping label is attached. Please drop it off within 14 days.
Once we receive your items, your refund of {{refund_amount}} will be processed within 3–5 business days.

— Acme Store`,
  },
  'Rejected': {
    subject: 'Update on your return request',
    body: `Hi {{customer_name}},

After reviewing your return request, we're unable to approve it.

Reason: {{rejection_reason}}

If you have questions, just reply to this email.

— Acme Store`,
  },
  'Refunded': {
    subject: 'Your refund has been issued ✨',
    body: `Hi {{customer_name}},

Your refund of {{refund_amount}} has been issued to your original payment method.

It may take 3–5 business days to appear on your statement.

Thanks for shopping with us.
— Acme Store`,
  },
  'Shipped': {
    subject: 'We got it — your return is on its way',
    body: `Hi {{customer_name}},

We've confirmed that your items for return {{rma_number}} are on their way back to us.

Carrier: {{carrier}}
Tracking: {{tracking_number}}

We'll inspect them as soon as they arrive and notify you when your refund is processed.

— Acme Store`,
  },
  'Expired': {
    subject: 'Your return request has expired — {{rma_number}}',
    body: `Hi {{customer_name}},

Your return request {{rma_number}} for order {{order_number}} has expired because we didn't receive your shipment within the required timeframe.

If you still need to return your items, please contact us and we'll do our best to help.

— Acme Store`,
  },
};

export const INVOICES = [
  { id: 'INV-2026-005', date: 'May 01, 2026', amount: '$19.00', status: 'Paid' },
  { id: 'INV-2026-004', date: 'Apr 01, 2026', amount: '$19.00', status: 'Paid' },
  { id: 'INV-2026-003', date: 'Mar 01, 2026', amount: '$19.00', status: 'Paid' },
];

export const PORTAL_ORDER = {
  number: '#1089',
  email: 'sarah.johnson@email.com',
  placed: 'April 28, 2026',
  items: [
    { id: 'p1', name: 'Classic White Tee', variant: 'Size L · White', qty: 1, price: 29.00, color: '#f0f0f5' },
    { id: 'p2', name: 'Black Joggers', variant: 'Size XL · Black', qty: 1, price: 54.00, color: '#222536' },
  ],
};

// Refund type metadata
export const REFUND_TYPES: Record<string, any> = {
  ORIGINAL_PAYMENT: { label: 'Original payment', short: 'Card refund', icon: 'CreditCard', color: '#8B8FA8', bg: 'rgba(139,143,168,0.15)' },
  STORE_CREDIT: { label: 'Store credit', short: 'Store credit', icon: 'Gift', color: '#6C63FF', bg: 'rgba(108,99,255,0.15)' },
  EXCHANGE: { label: 'Exchange', short: 'Exchange', icon: 'RefreshCw', color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' },
};

// Default shop-side settings (the merchant configures these in Settings > General)
export const DEFAULT_SHOP_SETTINGS = {
  allowStoreCredit: true,
  allowExchanges: false,
  storeCreditBonusPercent: 10,
  incentivizeStoreCredit: false,
};
