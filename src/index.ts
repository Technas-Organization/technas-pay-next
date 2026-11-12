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
}

export interface Payment {
  id: string;
  reference: string;
  amount: number;
  /** `null` tant que le payeur n'a pas choisi son pays sur la page de paiement. */
  currency: string | null;
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
  createdAt: string;
}

export interface RefundEvent {
  id: string;
  type: "refund.completed" | "refund.failed";
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

export type TechnasPayEvent = PaymentEvent | PayoutDestinationEvent | RefundEvent | TopUpEvent | OtherEvent;

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
    readonly details: { missingAmount?: number; currency?: string; refundableAmount?: number } = {},
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
  if (raw.type === "refund.completed" || raw.type === "refund.failed") {
    return { id: raw.id, type: raw.type, createdAt: raw.created_at, refund: parseRefund(d) };
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
    },
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
        } else if (event.type === "refund.completed" || event.type === "refund.failed") {
          await handlers.onRefund?.(event as RefundEvent);
        } else if (event.type === "balance.topped_up") {
          await handlers.onTopUp?.(event as TopUpEvent);
        }
        // Un type inconnu est acquitté : il ne doit pas être relivré pendant trois jours.
        return Response.json({ received: true });
      };
    },
  };
}

export type TechnasPay = ReturnType<typeof createTechnasPay>;
