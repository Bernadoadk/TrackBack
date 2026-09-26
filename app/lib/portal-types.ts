/** Shapes exchanged between the portal server and the portal UI. Pure types. */
import type { Locale, PortalDictionary, PayoutMethodKey } from "./i18n";
import type { FeeSettings, IneligibleReason, ReturnMethodKey } from "./returns-logic";

export type PortalView = "return" | "status" | "withdrawal";

export interface PortalConfig {
  shop: string;
  storeName: string;
  locale: Locale;
  locales: Locale[];
  texts: PortalDictionary;
  currency: string;
  embed: boolean;
  layout: string;
  brandColor: string;
  bannerColor: string;
  logoUrl: string | null;
  supportEmail: string;
  storeUrl: string;
  policy: string;
  reasons: { label: string; requirePhoto: boolean }[];
  refundOptions: { storeCredit: boolean; exchange: boolean; shopNow: boolean };
  bonus: { enabled: boolean; percent: number };
  fees: FeeSettings & { enabled: boolean };
  green: { enabled: boolean; maxAmount: number };
  photos: { enabled: boolean };
  returnMethods: ReturnMethodKey[];
  returnAddress: string;
  storeDropoffInfo: string;
  pickupInfo: string;
  cod: { enabled: boolean; methods: PayoutMethodKey[] };
  withdrawal: boolean;
  chat: { enabled: boolean; icon: string };
  whatsapp: { number: string | null; optIn: boolean };
  poweredBy: string;
  initialView: PortalView;
  initialStatus: StatusView | null;
  unavailable: boolean;
}

export interface PortalLine {
  id: string;
  title: string;
  variantTitle: string;
  image: string | null;
  unitPrice: number;
  quantity: number;
  productId: string;
  variantId: string;
  eligible: boolean;
  maxQty: number;
  reason?: IneligibleReason;
  deadline?: string;
}

export interface PortalOrderDTO {
  id: string;
  name: string;
  createdAt: string;
  customerName: string;
  email: string;
  phone: string | null;
  isOfflinePayment: boolean;
  lines: PortalLine[];
}

export interface FindOrderResponse {
  order?: PortalOrderDTO;
  token?: string;
  chatToken?: string;
  error?: keyof PortalDictionary;
}

export interface ExchangeOption {
  id: string;
  title: string;
  productTitle: string;
  productId: string;
  price: number;
  available: boolean;
  image: string | null;
}

export interface StatusView {
  rma: string;
  status: string;
  requestType: string;
  orderName: string;
  createdAt: string;
  items: { name: string; variant: string; quantity: number; image: string | null }[];
  refundType: string;
  refundAmount: number;
  currency: string;
  returnMethod: string;
  keepItem: boolean;
  instructions: {
    method: string;
    address: string;
    storeInfo: string;
    pickupInfo: string;
    labelUrl: string | null;
  };
  tracking: { carrier: string | null; number: string | null; url: string | null };
  rejectionReason: string | null;
  timeline: { key: string; date: string }[];
  payout: { method: string | null; account: string | null } | null;
  canSubmitTracking: boolean;
  statusToken: string;
}
