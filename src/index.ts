const DEFAULT_BASE_URL = "https://pay-api.technas.fr";
const SIGNATURE_HEADER = "x-technas-payment-signature";
const DEFAULT_TOLERANCE_S = 300;

export type PaymentStatus = "creating" | "pending" | "completed" | "failed" | "amount_mismatch";

export interface AskForPaymentInput {
  /** Montant entier en unité principale : 5000 = 5 000 FCFA. */
  amount: number;
  /**
   * Facultative. Sans elle : la devise du pays du client (`customer.country`, zone franc CFA),
   * sinon `defaultCurrency`, sinon le payeur choisit son pays sur la page de paiement
   * (XOF ou XAF, même montant : les deux francs CFA sont à parité fixe).
   */
  currency?: string;
  /** Votre identifiant de commande. La même référence ne crée jamais deux paiements. */
  reference: string;
  /**
   * `country` : code ISO à deux lettres ("TG", "CM"…). Sans `currency`, il fixe la devise
   * (zone franc CFA seulement) ; hors de cette zone, passez `currency`.
   * `phone` au format international aide la page de paiement à proposer le bon pays.
   */
  customer: { email: string; name: string; phone?: string; country?: string };
  /** Page de retour après un paiement réussi. Elle ne prouve pas le paiement : seul le webhook le prouve. */
  returnUrl: string;
  description?: string;
  /** Rendues telles quelles dans le webhook. 4 Ko maximum. */
  metadata?: Record<string, unknown>;
  /** Pour CE paiement : seuls ces pays (codes ISO), en plus des règles de votre compte. */
  allowedCountries?: string[];
  /** Pour CE paiement : ces pays sont refusés. */
  excludedCountries?: string[];
  /**
   * Avec `currency` : le client choisit quand même son pays, parmi ceux de cette devise
   * (ex. `currency: "XAF", askCountry: true` → Cameroun, Congo, Gabon…).
   */
  askCountry?: boolean;
}

/** Hors zone franc CFA : le change appliqué à un paiement. */
export interface PaymentFx {
  /** `local` ou `converted` : dans les deux cas, payé et crédité d'abord dans la devise du client. */
  mode: "local" | "converted";
  /** Unités de la devise payée pour 1 F CFA, avant marge. */
  rate: number;
  /** Le même cours, lisible : 1 unité de la devise payée = `francPerUnit` F CFA. */
  francPerUnit: number;
  /** Votre supplément de change, payé par le client et qui vous revient, en %. */
  marginPct: number;
  /** D'où vient le cours ("Bank of Ghana"…). */
  source: string | null;
  /** La devise dans laquelle votre solde est crédité. */
  creditedCurrency: string;
}

export interface Payment {
  id: string;
  reference: string;
  amount: number;
  /** `null` tant que le payeur n'a pas choisi son pays sur la page de paiement. */
  currency: string | null;
  /** Déjà remboursé : par Technas (`refund`) ou enregistré (`recordExternalRefund`). */
  refundedAmount: number;
  /** Hors zone CFA : le montant que vous avez demandé, en F CFA. `null` sinon. */
  originalAmount: number | null;
  originalCurrency: string | null;
  /** Hors zone CFA : le change appliqué. `null` sinon. */
  fx: PaymentFx | null;
  /** Part de Technas. */
  commission: number;
  /** Ce qui vous revient. */
  netAmount: number;
  status: PaymentStatus;
  checkoutUrl: string | null;
  metadata: Record<string, unknown>;
  testMode: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface Balance {
  currency: string;
  amount: number;
}

export interface Settlement {
  id: string;
  /** Ce qui a quitté votre solde. */
  amount: number;
  /** Frais du versement mobile money, à votre charge : vous recevez `amount - fee`. */
  fee: number;
  currency: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
}

export interface PaymentEvent {
  /** Stable d'un essai à l'autre : servez-vous-en pour ignorer un doublon. */
  id: string;
  type: "payment.completed" | "payment.failed";
  createdAt: string;
  payment: {
    id: string;
    reference: string;
    status: PaymentStatus;
    amount: number;
    currency: string;
    commission: number;
    netAmount: number;
    metadata: Record<string, unknown>;
    completedAt: string | null;
    /** Hors zone CFA : le montant demandé en F CFA ; `amount` et `currency` sont ce qui a été payé. */
    originalAmount: number | null;
    originalCurrency: string | null;
    fx: PaymentFx | null;
  };
}

/** Le numéro mobile money où Technas vous reverse votre solde. */
export interface PayoutDestination {
  /** Code pays ISO à deux lettres : "TG", "BJ", "CM"… */
  country: string;
  /** Code réseau de `getPayoutNetworks(country)` : "moov_tg", "togocel"… */
  network: string;
  /** Format international : "+22890000000". */
  phone: string;
  /** Nom du titulaire du compte mobile money. */
  beneficiaryName: string;
}

export interface PayoutDestinationView extends PayoutDestination {
  currency: string;
  /**
   * `awaiting_confirmation` : le responsable du compte a reçu un e-mail, rien ne change avant son clic.
   * `scheduled` : confirmé, actif à `effectiveAt` (48 h après la confirmation d'un changement).
   * `active` : reçoit les reversements de cette devise.
   */
  status: "awaiting_confirmation" | "scheduled" | "active";
  effectiveAt: string | null;
  confirmExpiresAt: string | null;
}

/** Un numéro par devise : on ne verse pas des XAF sur un numéro du Togo. */
export interface PayoutDestinationState {
  destinations: {
    currency: string;
    /** `null` : aucun reversement ne peut partir dans cette devise ; l'argent attend sur le solde. */
    current: PayoutDestinationView | null;
    pending: PayoutDestinationView | null;
  }[];
}

export interface PayoutNetwork {
  code: string;
  name: string;
  /** La devise versée sur ce réseau. */
  currency: string | null;
}

export interface PayoutDestinationEvent {
  id: string;
  /**
   * `payout_destination.change_scheduled` : un nouveau numéro a été demandé, actif dans 48 h.
   * Si ce n'est pas vous, prévenez Technas tout de suite.
   * `payout_destination.updated` : ce numéro reçoit désormais vos reversements.
   */
  type: "payout_destination.change_scheduled" | "payout_destination.updated";
  createdAt: string;
  destination: PayoutDestinationView;
}

/** Qui paie les frais mobile money du renvoi d'un remboursement. */
export type RefundFees = "partner" | "customer";

export interface Refund {
  id: string;
  paymentId: string;
  /** La `reference` de la commande remboursée. */
  paymentReference: string;
  /** Ce qui est décompté du paiement : jamais plus que le montant payé, au total. */
  amount: number;
  /** Ce qui arrive sur le téléphone du client : `amount`, moins `fee` si `fees` vaut `"customer"`. */
  sentAmount: number;
  /** Frais mobile money du renvoi. */
  fee: number;
  fees: RefundFees;
  /** Ce qui a quitté votre solde : `amount + fee` (`"partner"`) ou `amount` (`"customer"`). */
  balanceDebit: number;
  currency: string;
  /** `pending` : en route, le résultat arrive par webhook (`refund.completed` ou `refund.failed`). */
  status: "pending" | "completed" | "failed";
  /** Raison d'un échec. Le solde est alors recrédité de `balanceDebit`. */
  failure: string | null;
  /** `payout` : renvoyé par Technas. `external` : fait hors plateforme, seulement enregistré. */
  kind: "payout" | "external";
  /** Remboursement enregistré : le moyen utilisé ("Flooz", "Espèces"…), la note, qui l'a fait. */
  method: string | null;
  note: string | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface RefundEvent {
  id: string;
  /** `refund.recorded` : un remboursement fait hors plateforme vient d'être enregistré. */
  type: "refund.completed" | "refund.failed" | "refund.recorded";
  createdAt: string;
  refund: Refund;
}

export interface TopUp {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  /** Ouvrez cette page pour payer la recharge par mobile money. */
  checkoutUrl: string;
  testMode: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface TopUpEvent {
  id: string;
  type: "balance.topped_up";
  createdAt: string;
  topUp: { id: string; amount: number; currency: string; completedAt: string | null };
}

/** Un type d'événement que cette version du package ne connaît pas encore. */
export interface OtherEvent {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}

export type TechnasPayEvent =
  | PaymentEvent
  | PayoutDestinationEvent
  | RefundEvent
  | TopUpEvent
  | BalanceConvertedEvent
  | FxModeEvent
  | OtherEvent;

export interface WebhookHandlers {
  onCompleted?: (event: PaymentEvent) => void | Promise<void>;
  /** Un refus n'est pas définitif : le client peut réessayer et `onCompleted` arriver ensuite. */
  onFailed?: (event: PaymentEvent) => void | Promise<void>;
  /** Changement de numéro de reversement demandé ou devenu actif. */
  onPayoutDestination?: (event: PayoutDestinationEvent) => void | Promise<void>;
  /** Remboursement arrivé (`refund.completed`) ou échoué (`refund.failed`, solde recrédité). Prévenez votre client. */
  onRefund?: (event: RefundEvent) => void | Promise<void>;
  /** Recharge de solde payée. */
  onTopUp?: (event: TopUpEvent) => void | Promise<void>;
  /** Mode `converted` : une partie de votre solde a été changée en F CFA, au cours et au coût réels. */
  onBalanceConverted?: (event: BalanceConvertedEvent) => void | Promise<void>;
  /** Votre option hors zone CFA a changé. Si ce n'est pas vous, prévenez Technas. */
  onFxModeUpdated?: (event: FxModeEvent) => void | Promise<void>;
}

export interface TechnasPayOptions {
  /** Le secret fourni par Technas, en général `process.env.TECHNAS_PAY_SECRET`. */
  secret: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Âge maximal accepté pour un webhook, en secondes. 300 par défaut. */
  webhookToleranceSeconds?: number;
  /**
   * Devise d'un paiement sans `currency` ni pays du client connu : "XOF", "XAF"…
   * Inutile en zone franc CFA : sans elle, le payeur choisit son pays et la devise suit.
   */
  defaultCurrency?: string;
}

/**
 * Zone franc CFA : pays → devise. UEMOA en XOF, CEMAC en XAF, à parité fixe : un montant
 * sans devise vaut la même chose dans les deux. Hors de cette zone, il faudrait convertir :
 * passez `currency` vous-même.
 */
export const CURRENCY_BY_COUNTRY: Readonly<Record<string, string>> = Object.freeze({
  // UEMOA
  BJ: "XOF", BF: "XOF", CI: "XOF", GW: "XOF", ML: "XOF", NE: "XOF", SN: "XOF", TG: "XOF",
  // CEMAC
  CM: "XAF", CF: "XAF", CG: "XAF", GA: "XAF", GQ: "XAF", TD: "XAF",
});

/** La devise d'un pays de la zone franc CFA (code ISO à deux lettres), sinon `undefined`. */
export function currencyForCountry(country: string | undefined): string | undefined {
  return country ? CURRENCY_BY_COUNTRY[country.trim().toUpperCase()] : undefined;
}

export class TechnasPayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** 0 quand le service n'a pas pu être joint, ou que l'erreur est détectée avant tout appel. */
    readonly status: number,
    readonly errors?: { field: string; message: string }[],
    /**
     * Précisions selon le code : `missingAmount` et `currency` pour `insufficient_balance`
     * (rechargez au moins ce montant avec `topUpBalance`), `refundableAmount` pour
     * `refund_exceeds_payment`.
     */
    readonly details: {
      missingAmount?: number;
      currency?: string;
      refundableAmount?: number;
      /** `country_not_available` : ce qui manque (`no_payout_number`…). */
      reason?: string;
      /** `risk_not_accepted` : le texte du risque à accepter. */
      risk?: string;
    } = {},
  ) {
    super(message);
    this.name = "TechnasPayError";
  }

  /** Vrai si refaire le même appel, avec la même référence, a du sens. */
  get retryable(): boolean {
    return this.code === "network_error" || this.status === 429 || this.status >= 500 || this.code === "payment_in_progress";
  }
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

interface ParsedSecret {
  apiKey: string;
  webhookSecret: string;
  mode: "live" | "test";
}

function parseSecret(secret: string | undefined): ParsedSecret {
  // Le message ne cite jamais la valeur reçue : il finirait dans des journaux.
  const match = /^tps_(live|test)_([^.\s]+)\.([^.\s]+)$/.exec(secret ?? "");
  if (!match) {
    throw new TechnasPayError(
      "invalid_secret",
      "Secret Technas absent ou mal formé. Vérifiez la variable TECHNAS_PAY_SECRET.",
      0,
    );
  }
  return { mode: match[1] as "live" | "test", apiKey: match[2]!, webhookSecret: match[3]! };
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function parsePayment(raw: any): Payment {
  return {
    id: raw.id,
    reference: raw.reference,
    amount: raw.amount,
    currency: raw.currency,
    commission: raw.commission,
    netAmount: raw.net_amount,
    status: raw.status,
    refundedAmount: raw.refunded_amount ?? 0,
    originalAmount: raw.original_amount ?? null,
    originalCurrency: raw.original_currency ?? null,
    fx: parseFx(raw.fx),
    checkoutUrl: raw.checkout_url ?? null,
    metadata: raw.metadata ?? {},
    testMode: Boolean(raw.test_mode),
    createdAt: raw.created_at,
    completedAt: raw.completed_at ?? null,
  };
}

function parseDestination(raw: any): PayoutDestinationView {
  return {
    currency: raw.currency,
    country: raw.country,
    network: raw.network,
    phone: raw.phone,
    beneficiaryName: raw.beneficiary_name,
    status: raw.status,
    effectiveAt: raw.effective_at ?? null,
    confirmExpiresAt: raw.confirm_expires_at ?? null,
  };
}

function parseEvent(raw: any): TechnasPayEvent {
  const d = raw?.data;
  if (!raw?.id || !raw?.type || typeof d !== "object" || d === null) throw new WebhookVerificationError("Webhook illisible");
  if (raw.type === "payout_destination.change_scheduled" || raw.type === "payout_destination.updated") {
    return {
      id: raw.id,
      type: raw.type,
      createdAt: raw.created_at,
      destination: parseDestination(d),
    };
  }
  if (raw.type === "refund.completed" || raw.type === "refund.failed" || raw.type === "refund.recorded") {
    return { id: raw.id, type: raw.type, createdAt: raw.created_at, refund: parseRefund(d) };
  }
  if (raw.type === "balance.converted") {
    return {
      id: raw.id, type: raw.type, createdAt: raw.created_at,
      conversion: {
        id: d.id, fromCurrency: d.from_currency, fromAmount: d.from_amount, toCurrency: d.to_currency,
        grossAmount: d.gross_amount, cost: d.cost, creditedAmount: d.credited_amount, effectiveRate: d.effective_rate,
      },
    };
  }
  if (raw.type === "fx_mode.updated") {
    return {
      id: raw.id, type: raw.type, createdAt: raw.created_at,
      fx: { mode: d.mode, previousMode: d.previous_mode, markupPct: d.markup_pct, homeCurrency: d.home_currency },
    };
  }
  if (raw.type === "balance.topped_up") {
    return {
      id: raw.id,
      type: raw.type,
      createdAt: raw.created_at,
      topUp: { id: d.id, amount: d.amount, currency: d.currency, completedAt: d.completed_at ?? null },
    };
  }
  if (raw.type !== "payment.completed" && raw.type !== "payment.failed") {
    return { id: raw.id, type: raw.type, createdAt: raw.created_at, data: d };
  }
  if (!d.id) throw new WebhookVerificationError("Webhook illisible");
  return {
    id: raw.id,
    type: raw.type,
    createdAt: raw.created_at,
    payment: {
      id: d.id,
      reference: d.reference,
      status: d.status,
      amount: d.amount,
      currency: d.currency,
      commission: d.commission,
      netAmount: d.net_amount,
      metadata: d.metadata ?? {},
      completedAt: d.completed_at ?? null,
      originalAmount: d.original_amount ?? null,
      originalCurrency: d.original_currency ?? null,
      fx: parseFx(d.fx),
    },
  };
}

function parseFx(raw: any): PaymentFx | null {
  if (!raw) return null;
  return {
    mode: raw.mode,
    rate: raw.rate,
    francPerUnit: raw.franc_per_unit,
    marginPct: raw.margin_pct ?? 0,
    source: raw.source ?? null,
    creditedCurrency: raw.credited_currency,
  };
}

/** Votre option hors zone CFA, ses risques, vos règles de pays, et ce qui est ouvert. */
export interface FxMode {
  /** `none` : seuls les pays de la zone CFA. `local` ou `converted` : voir `risks`. */
  mode: "none" | "local" | "converted";
  /** Devise de votre solde après change, en mode `converted`. */
  homeCurrency: string;
  /** Votre supplément de change, payé par le client et qui vous revient, en %. */
  markupPct: number;
  /** Quand vous avez accepté le risque de votre option (`null` : jamais). */
  riskAcceptedAt: string | null;
  riskVersion: string;
  /**
   * Ce que vous acceptez, dit simplement, pour `none`, `local`, `converted` et `markup`.
   * À lire (ou à faire lire par votre agent) avant `setFxMode`. Technas ne couvre aucun risque.
   */
  risks: Record<"none" | "local" | "converted" | "markup", string>;
  /** Où vous vendez : `allowed` (`null` : tous) et `excluded`. */
  countryRules: { allowed: string[] | null; excluded: string[] };
  countries: {
    country: string;
    name: string;
    currency: string;
    available: boolean;
    /**
     * Ce qui manque quand `available` est faux : `no_operator` (pas d'opérateur ouvert),
     * `no_fresh_rate` (pas de cours de moins de 24 h), `no_payout_number` (aucun numéro de
     * reversement confirmé dans la devise nécessaire), `no_fx_channel` (personne pour changer
     * ce solde), `currency_not_enabled`.
     */
    reason: string | null;
    rate: number | null;
    rateSource: string | null;
    ratePublishedAt: string | null;
    markupPct: number;
    /** Mode `converted` : coût estimé du change, en %. Le coût RÉEL vous sera retiré. */
    estimatedConversionCostPct: number | null;
  }[];
}

/** Un change fait pour vous en mode `converted`, au cours et au coût réels. */
export interface BalanceConvertedEvent {
  id: string;
  type: "balance.converted";
  createdAt: string;
  conversion: {
    id: string;
    fromCurrency: string;
    fromAmount: number;
    toCurrency: string;
    grossAmount: number;
    cost: number;
    creditedAmount: number;
    /** F CFA crédités par unité changée, coût compris. */
    effectiveRate: number;
  };
}

export interface FxModeEvent {
  id: string;
  type: "fx_mode.updated";
  createdAt: string;
  /** Si ce n'est pas vous qui avez changé d'option, prévenez Technas : votre clé a peut-être fuité. */
  fx: { mode: string; previousMode: string; markupPct: number; homeCurrency: string };
}

function parseFxMode(raw: any): FxMode {
  return {
    mode: raw.mode,
    homeCurrency: raw.home_currency,
    markupPct: raw.markup_pct ?? 0,
    riskAcceptedAt: raw.risk_accepted_at ?? null,
    riskVersion: raw.risk_version,
    risks: raw.risks ?? {},
    countryRules: { allowed: raw.country_rules?.allowed ?? null, excluded: raw.country_rules?.excluded ?? [] },
    countries: (raw.countries ?? []).map((c: any) => ({
      country: c.country,
      name: c.name,
      currency: c.currency,
      available: Boolean(c.available),
      reason: c.reason ?? null,
      rate: c.rate ?? null,
      rateSource: c.rate_source ?? null,
      ratePublishedAt: c.rate_published_at ?? null,
      markupPct: c.markup_pct ?? 0,
      estimatedConversionCostPct: c.estimated_conversion_cost_pct ?? null,
    })),
  };
}

function parseRefund(raw: any): Refund {
  return {
    id: raw.id,
    paymentId: raw.payment_id,
    paymentReference: raw.payment_reference,
    amount: raw.amount,
    sentAmount: raw.sent_amount,
    fee: raw.fee,
    fees: raw.fees,
    balanceDebit: raw.balance_debit,
    currency: raw.currency,
    status: raw.status,
    failure: raw.failure ?? null,
    kind: raw.kind ?? "payout",
    method: raw.method ?? null,
    note: raw.note ?? null,
    recordedBy: raw.recorded_by ?? null,
    createdAt: raw.created_at,
  };
}

function parseDestinationState(raw: any): PayoutDestinationState {
  return {
    destinations: (raw?.destinations ?? []).map((d: any) => ({
      currency: d.currency,
      current: d.current ? parseDestination(d.current) : null,
      pending: d.pending ? parseDestination(d.pending) : null,
    })),
  };
}

export function createTechnasPay(options: TechnasPayOptions) {
  // Lu au premier appel : `next build` importe ce module sans les variables de production.
  let parsed: ParsedSecret | undefined;
  const secrets = () => (parsed ??= parseSecret(options.secret));
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const tolerance = options.webhookToleranceSeconds ?? DEFAULT_TOLERANCE_S;
  const defaultCurrency = options.defaultCurrency?.trim().toUpperCase() || undefined;

  // Jamais de devise devinée. Sans devise ni pays connu, Technas fait choisir son pays au payeur.
  // Un pays hors zone franc CFA sans devise est refusé par Technas (`currency_conversion_unavailable`).
  function resolveCurrency(input: AskForPaymentInput): string | undefined {
    const explicit = input.currency?.trim().toUpperCase();
    if (explicit) return explicit;
    const country = input.customer?.country?.trim();
    if (country) return currencyForCountry(country);
    return defaultCurrency;
  }

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { apiKey } = secrets();
    const doFetch = options.fetch ?? fetch;
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new TechnasPayError("network_error", "Service de paiement injoignable", 0);
    }
    const data: any = await response.json().catch(() => null);
    if (!response.ok) {
      throw new TechnasPayError(
        data?.code ?? "request_failed",
        data?.message ?? `Réponse HTTP ${response.status}`,
        response.status,
        data?.errors,
        {
          ...(data?.missing_amount !== undefined ? { missingAmount: data.missing_amount } : {}),
          ...(data?.currency !== undefined ? { currency: data.currency } : {}),
          ...(data?.refundable_amount !== undefined ? { refundableAmount: data.refundable_amount } : {}),
          ...(data?.reason !== undefined ? { reason: data.reason } : {}),
          ...(data?.risk !== undefined ? { risk: data.risk } : {}),
        },
      );
    }
    return data as T;
  }

  /** Vérifie la signature sur le corps BRUT et rend l'événement. */
  async function verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<TechnasPayEvent> {
    const match = /^t=(\d+),s=([0-9a-f]+)$/i.exec(signatureHeader ?? "");
    if (!match) throw new WebhookVerificationError("Signature absente ou mal formée");
    const timestamp = Number(match[1]);
    if (Math.abs(Date.now() / 1000 - timestamp) > tolerance) {
      throw new WebhookVerificationError("Signature trop ancienne");
    }
    const expected = await hmacHex(secrets().webhookSecret, `${timestamp}.${rawBody}`);
    if (!constantTimeEqual(expected, match[2]!.toLowerCase())) {
      throw new WebhookVerificationError("Signature invalide");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      throw new WebhookVerificationError("Webhook illisible");
    }
    return parseEvent(raw);
  }

  return {
    /** Crée la demande de paiement. Redirigez ensuite le client vers `checkoutUrl`. */
    async askForPayment(input: AskForPaymentInput): Promise<Payment & { checkoutUrl: string }> {
      if (!Number.isInteger(input.amount) || input.amount <= 0) {
        throw new TechnasPayError("invalid_amount", "amount doit être un entier positif (5000 = 5 000 FCFA)", 0);
      }
      const currency = resolveCurrency(input);
      const raw = await call<any>("POST", "/v1/payments", {
        amount: input.amount,
        ...(currency ? { currency } : {}),
        reference: input.reference,
        customer: input.customer,
        return_url: input.returnUrl,
        description: input.description,
        metadata: input.metadata ?? {},
        ...(input.allowedCountries ? { allowed_countries: input.allowedCountries } : {}),
        ...(input.excludedCountries ? { excluded_countries: input.excludedCountries } : {}),
        ...(input.askCountry ? { ask_country: true } : {}),
      });
      return parsePayment(raw) as Payment & { checkoutUrl: string };
    },

    async getPayment(id: string): Promise<Payment> {
      return parsePayment(await call<any>("GET", `/v1/payments/${encodeURIComponent(id)}`));
    },

    /** Pour rattraper un webhook manqué. */
    async getPaymentByReference(reference: string): Promise<Payment> {
      return parsePayment(await call<any>("GET", `/v1/payments?reference=${encodeURIComponent(reference)}`));
    },

    /** Vos paiements, du plus récent au plus ancien, par pages. */
    async listTransactions(
      options: { limit?: number; status?: Exclude<PaymentStatus, "creating">; cursor?: string } = {},
    ): Promise<{ items: Payment[]; nextCursor: string | null }> {
      const query = new URLSearchParams();
      if (options.limit !== undefined) query.set("limit", String(options.limit));
      if (options.status) query.set("status", options.status);
      if (options.cursor) query.set("cursor", options.cursor);
      const suffix = query.size ? `?${query}` : "";
      const raw = await call<any>("GET", `/v1/transactions${suffix}`);
      return { items: raw.items.map(parsePayment), nextCursor: raw.next_cursor ?? null };
    },

    /**
     * Rembourse un paiement `completed` : l'argent repart au numéro qui a payé.
     * Sans `amount`, tout ce qui reste remboursable. Votre solde est débité tout de suite
     * (`balanceDebit`) ; la commission Technas n'est pas rendue. `fees` : `"partner"`
     * (défaut : le client reçoit tout, les frais s'ajoutent au débit) ou `"customer"`.
     * Rejouer le même appel ne rembourse pas deux fois. Deux remboursements partiels
     * identiques et voulus : donnez à chacun sa `reference`.
     * C'est à vous de prévenir le client.
     */
    async refund(
      paymentId: string,
      options: { amount?: number; fees?: RefundFees; reference?: string } = {},
    ): Promise<Refund> {
      if (options.amount !== undefined && (!Number.isInteger(options.amount) || options.amount <= 0)) {
        throw new TechnasPayError("invalid_amount", "amount doit être un entier positif (5000 = 5 000 FCFA)", 0);
      }
      if (options.fees !== undefined && options.fees !== "partner" && options.fees !== "customer") {
        throw new TechnasPayError("invalid_request", 'fees vaut "partner" ou "customer"', 0);
      }
      const raw = await call<any>("POST", `/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
        ...(options.amount !== undefined ? { amount: options.amount } : {}),
        fees: options.fees ?? "partner",
        ...(options.reference ? { reference: options.reference } : {}),
      });
      return parseRefund(raw);
    },

    /**
     * Enregistre un remboursement que vous avez fait HORS Technas (Flooz, T-Money, espèces…).
     * Aucun argent ne bouge, votre solde ne change pas. Il compte dans le plafond : avec
     * les remboursements de `refund`, jamais plus que le montant payé. Rejouer le même
     * appel n'enregistre pas deux fois.
     */
    async recordExternalRefund(
      paymentId: string,
      input: { amount: number; method: string; note?: string; recordedBy?: string; reference?: string },
    ): Promise<Refund> {
      if (!Number.isInteger(input.amount) || input.amount <= 0) {
        throw new TechnasPayError("invalid_amount", "amount doit être un entier positif (5000 = 5 000 FCFA)", 0);
      }
      if (!input.method?.trim()) {
        throw new TechnasPayError("invalid_request", 'method est obligatoire : "Flooz", "Espèces"…', 0);
      }
      const raw = await call<any>("POST", `/v1/payments/${encodeURIComponent(paymentId)}/external-refunds`, {
        amount: input.amount,
        method: input.method.trim(),
        ...(input.note ? { note: input.note } : {}),
        ...(input.recordedBy ? { recorded_by: input.recordedBy } : {}),
        ...(input.reference ? { reference: input.reference } : {}),
      });
      return parseRefund(raw);
    },

    async getRefund(refundId: string): Promise<Refund> {
      return parseRefund(await call<any>("GET", `/v1/refunds/${encodeURIComponent(refundId)}`));
    },

    /**
     * Recharge votre solde par mobile money, sans commission : ouvrez `checkoutUrl`.
     * Le crédit arrive avec le webhook `balance.topped_up`.
     */
    async topUpBalance(input: { amount: number; currency: string; returnUrl?: string }): Promise<TopUp> {
      if (!Number.isInteger(input.amount) || input.amount <= 0) {
        throw new TechnasPayError("invalid_amount", "amount doit être un entier positif (5000 = 5 000 FCFA)", 0);
      }
      const raw = await call<any>("POST", "/v1/balance/top-ups", {
        amount: input.amount,
        currency: input.currency,
        ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      });
      return {
        id: raw.id,
        amount: raw.amount,
        currency: raw.currency,
        status: raw.status,
        checkoutUrl: raw.checkout_url,
        testMode: Boolean(raw.test_mode),
        createdAt: raw.created_at,
        completedAt: raw.completed_at ?? null,
      };
    },

    /** Votre option hors zone CFA, ses risques en clair, vos règles de pays, les pays ouverts. */
    async getFxMode(): Promise<FxMode> {
      return parseFxMode(await call<any>("GET", "/v1/fx"));
    },

    /**
     * Choisit votre option hors zone CFA. Pour `local` ou `converted`, `acceptRisk: true` est
     * obligatoire : lisez d'abord `(await getFxMode()).risks`. Technas ne couvre aucun risque.
     * `markupPct` (0 à 20) : supplément de change payé par le client, qui vous revient.
     */
    async setFxMode(input: {
      mode: "none" | "local" | "converted";
      acceptRisk?: boolean;
      markupPct?: number;
      homeCurrency?: "XOF" | "XAF";
    }): Promise<FxMode> {
      return parseFxMode(await call<any>("PUT", "/v1/fx", {
        mode: input.mode,
        accept_risk: input.acceptRisk === true,
        ...(input.markupPct !== undefined ? { markup_pct: input.markupPct } : {}),
        ...(input.homeCurrency ? { home_currency: input.homeCurrency } : {}),
      }));
    },

    /** Où vous vendez, pour tous vos paiements : pays autorisés (absent : tous) et exclus. Codes ISO. */
    async setCountryRules(rules: { allowed?: string[] | null; excluded?: string[] }): Promise<{ allowed: string[] | null; excluded: string[] }> {
      return call<any>("PUT", "/v1/country-rules", { allowed: rules.allowed ?? null, excluded: rules.excluded ?? [] });
    },

    /** Ce que Technas vous doit, par devise. */
    async getBalance(): Promise<Balance[]> {
      return call<Balance[]>("GET", "/v1/balance");
    },

    async getSettlements(): Promise<Settlement[]> {
      const rows = await call<any[]>("GET", "/v1/settlements");
      return rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        fee: r.fee ?? 0,
        currency: r.currency,
        status: r.status,
        createdAt: r.created_at,
      }));
    },

    /** Les réseaux mobile money qui acceptent un reversement dans ce pays. */
    async getPayoutNetworks(country: string): Promise<PayoutNetwork[]> {
      return call<PayoutNetwork[]>("GET", `/v1/payout-networks?country=${encodeURIComponent(country)}`);
    },

    /** Vos numéros de reversement, un par devise, et les changements en attente. */
    async getPayoutDestination(): Promise<PayoutDestinationState> {
      return parseDestinationState(await call<any>("GET", "/v1/payout-destination"));
    },

    /**
     * Demande que vos reversements dans la devise de ce réseau arrivent sur ce numéro.
     * RIEN ne change avant que le responsable de votre compte ait cliqué le lien reçu
     * par e-mail (valable 24 h). Premier numéro de la devise : actif au clic ; changement :
     * actif 48 h après, annoncé par un webhook `payout_destination.change_scheduled`.
     * Reposer le numéro actif annule un changement en attente.
     */
    async setPayoutDestination(destination: PayoutDestination): Promise<PayoutDestinationState> {
      return parseDestinationState(
        await call<any>("PUT", "/v1/payout-destination", {
          country: destination.country,
          network: destination.network,
          phone: destination.phone,
          beneficiary_name: destination.beneficiaryName,
        }),
      );
    },

    verifyWebhook,

    /**
     * Fabrique un webhook signé pour tester votre route sans attendre un vrai envoi.
     * Refusé avec un secret réel. `await POST(await pay.createTestWebhook(...))`.
     */
    async createTestWebhook(
      type: PaymentEvent["type"],
      payment: { reference: string; amount: number; currency: string; commission?: number; metadata?: Record<string, unknown> },
      url = "http://localhost/api/technas-pay",
    ): Promise<Request> {
      if (secrets().mode !== "test") {
        throw new TechnasPayError("test_only", "createTestWebhook exige un secret tps_test_", 0);
      }
      const commission = payment.commission ?? 0;
      const completed = type === "payment.completed";
      const now = new Date().toISOString();
      const body = JSON.stringify({
        id: crypto.randomUUID(),
        type,
        created_at: now,
        data: {
          id: crypto.randomUUID(),
          reference: payment.reference,
          status: completed ? "completed" : "failed",
          amount: payment.amount,
          currency: payment.currency,
          commission,
          net_amount: payment.amount - commission,
          metadata: payment.metadata ?? {},
          completed_at: completed ? now : null,
        },
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await hmacHex(secrets().webhookSecret, `${timestamp}.${body}`);
      return new Request(url, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json", [SIGNATURE_HEADER]: `t=${timestamp},s=${signature}` },
      });
    },

    /**
     * Route Handler prêt à exporter : `export const POST = pay.webhookHandler({...})`.
     * Répond 2xx quand vos fonctions ont réussi. Sinon Technas relivre le même événement.
     */
    webhookHandler(handlers: WebhookHandlers) {
      return async (request: Request): Promise<Response> => {
        const rawBody = await request.text();
        let event: TechnasPayEvent;
        try {
          event = await verifyWebhook(rawBody, request.headers.get(SIGNATURE_HEADER));
        } catch (error) {
          if (error instanceof WebhookVerificationError) {
            return Response.json({ error: "invalid_signature" }, { status: 400 });
          }
          throw error;
        }
        if (event.type === "payment.completed") await handlers.onCompleted?.(event as PaymentEvent);
        else if (event.type === "payment.failed") await handlers.onFailed?.(event as PaymentEvent);
        else if (event.type.startsWith("payout_destination.")) {
          await handlers.onPayoutDestination?.(event as PayoutDestinationEvent);
        } else if (event.type.startsWith("refund.")) {
          await handlers.onRefund?.(event as RefundEvent);
        } else if (event.type === "balance.topped_up") {
          await handlers.onTopUp?.(event as TopUpEvent);
        } else if (event.type === "balance.converted") {
          await handlers.onBalanceConverted?.(event as BalanceConvertedEvent);
        } else if (event.type === "fx_mode.updated") {
          await handlers.onFxModeUpdated?.(event as FxModeEvent);
        }
        // Un type inconnu est acquitté : il ne doit pas être relivré pendant trois jours.
        return Response.json({ received: true });
      };
    },
  };
}

export type TechnasPay = ReturnType<typeof createTechnasPay>;
