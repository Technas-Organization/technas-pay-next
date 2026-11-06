const DEFAULT_BASE_URL = "https://pay-api.technas.fr";
const SIGNATURE_HEADER = "x-technas-payment-signature";
const DEFAULT_TOLERANCE_S = 300;

export type PaymentStatus = "creating" | "pending" | "completed" | "failed" | "amount_mismatch";

export interface AskForPaymentInput {
  /** Montant entier en unité principale : 5000 = 5 000 FCFA. */
  amount: number;
  currency: string;
  /** Votre identifiant de commande. La même référence ne crée jamais deux paiements. */
  reference: string;
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
  currency: string;
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
  amount: number;
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

export interface WebhookHandlers {
  onCompleted?: (event: PaymentEvent) => void | Promise<void>;
  /** Un refus n'est pas définitif : le client peut réessayer et `onCompleted` arriver ensuite. */
  onFailed?: (event: PaymentEvent) => void | Promise<void>;
}

export interface TechnasPayOptions {
  /** Le secret fourni par Technas, en général `process.env.TECHNAS_PAY_SECRET`. */
  secret: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Âge maximal accepté pour un webhook, en secondes. 300 par défaut. */
  webhookToleranceSeconds?: number;
}

export class TechnasPayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** 0 quand le service n'a pas pu être joint. */
    readonly status: number,
    readonly errors?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = "TechnasPayError";
  }

  /** Vrai si refaire le même appel, avec la même référence, a du sens. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500 || this.code === "payment_in_progress";
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

function parseEvent(raw: any): PaymentEvent {
  const d = raw?.data;
  if (!raw?.id || !raw?.type || !d?.id) throw new WebhookVerificationError("Webhook illisible");
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

export function createTechnasPay(options: TechnasPayOptions) {
  // Lu au premier appel : `next build` importe ce module sans les variables de production.
  let parsed: ParsedSecret | undefined;
  const secrets = () => (parsed ??= parseSecret(options.secret));
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const tolerance = options.webhookToleranceSeconds ?? DEFAULT_TOLERANCE_S;

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
      );
    }
    return data as T;
  }

  /** Vérifie la signature sur le corps BRUT et rend l'événement. */
  async function verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<PaymentEvent> {
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
      const raw = await call<any>("POST", "/v1/payments", {
        amount: input.amount,
        currency: input.currency,
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

    /** Ce que Technas vous doit, par devise. */
    async getBalance(): Promise<Balance[]> {
      return call<Balance[]>("GET", "/v1/balance");
    },

    async getSettlements(): Promise<Settlement[]> {
      const rows = await call<any[]>("GET", "/v1/settlements");
      return rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        currency: r.currency,
        status: r.status,
        createdAt: r.created_at,
      }));
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
        let event: PaymentEvent;
        try {
          event = await verifyWebhook(rawBody, request.headers.get(SIGNATURE_HEADER));
        } catch (error) {
          if (error instanceof WebhookVerificationError) {
            return Response.json({ error: "invalid_signature" }, { status: 400 });
          }
          throw error;
        }
        if (event.type === "payment.completed") await handlers.onCompleted?.(event);
        else if (event.type === "payment.failed") await handlers.onFailed?.(event);
        return Response.json({ received: true });
      };
    },
  };
}

export type TechnasPay = ReturnType<typeof createTechnasPay>;
