import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { canRetry, createTechnasPay, currencyForCountry, isFinal, retryReference, TechnasPayError, WebhookVerificationError } from "../dist/index.js";

const SECRET = "tps_test_pk_abc-DEF_123.ws_webhook-secret_456";
const WEBHOOK_SECRET = "ws_webhook-secret_456";

function sign(body, ts = Math.floor(Date.now() / 1000), secret = WEBHOOK_SECRET) {
  return `t=${ts},s=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
}

const EVENT = JSON.stringify({
  id: "evt_1",
  type: "payment.completed",
  created_at: "2026-11-06T10:00:00Z",
  data: { id: "pay_1", reference: "cmd_1", status: "completed", amount: 5000, currency: "XOF", commission: 425, net_amount: 4575, metadata: { a: 1 } },
});

const request = (body, signature) =>
  new Request("https://p.test/webhook", {
    method: "POST",
    body,
    headers: signature ? { "x-technas-payment-signature": signature } : {},
  });

test("askForPayment n'envoie que la clé d'API, jamais le secret de webhook", async () => {
  let seen;
  const pay = createTechnasPay({
    secret: SECRET,
    baseUrl: "https://gw.test/",
    fetch: async (url, init) => {
      seen = { url, init };
      return Response.json({ id: "p1", reference: "cmd_1", amount: 5000, currency: "XOF", commission: 425, net_amount: 4575, status: "pending", checkout_url: "https://c.test", metadata: {}, test_mode: true, created_at: "x" });
    },
  });
  const payment = await pay.askForPayment({ amount: 5000, currency: "XOF", reference: "cmd_1", customer: { email: "a@b.co", name: "A" }, returnUrl: "https://p.test/ok" });
  assert.equal(seen.url, "https://gw.test/v1/payments");
  assert.equal(seen.init.headers.Authorization, "Bearer pk_abc-DEF_123");
  assert.ok(!JSON.stringify(seen.init).includes(WEBHOOK_SECRET));
  assert.equal(JSON.parse(seen.init.body).return_url, "https://p.test/ok");
  assert.equal(payment.checkoutUrl, "https://c.test");
  assert.equal(payment.netAmount, 4575);
});

test("un montant non entier est refusé avant tout appel", async () => {
  const pay = createTechnasPay({ secret: SECRET, fetch: () => assert.fail("aucun appel attendu") });
  await assert.rejects(
    pay.askForPayment({ amount: 50.5, currency: "XOF", reference: "r", customer: { email: "a@b.co", name: "A" }, returnUrl: "https://p.test" }),
    (e) => e instanceof TechnasPayError && e.code === "invalid_amount",
  );
});

test("les erreurs portent le code, et disent si on peut réessayer", async () => {
  const pay = createTechnasPay({ secret: SECRET, fetch: async () => Response.json({ code: "reference_conflict", message: "m" }, { status: 409 }) });
  await assert.rejects(pay.getBalance(), (e) => e.code === "reference_conflict" && e.status === 409 && e.retryable === false);
  const down = createTechnasPay({ secret: SECRET, fetch: async () => { throw new Error("réseau"); } });
  await assert.rejects(down.getBalance(), (e) => e.code === "network_error" && e.retryable === true);
});

test("un secret mal formé ne casse pas l'import, et n'apparaît pas dans l'erreur", async () => {
  const pay = createTechnasPay({ secret: "mon-secret-en-clair" });
  await assert.rejects(pay.getBalance(), (e) => e.code === "invalid_secret" && !e.message.includes("mon-secret-en-clair"));
});

test("webhook valide : la bonne fonction est appelée, avec les champs convertis", async () => {
  const pay = createTechnasPay({ secret: SECRET });
  let received;
  const response = await pay.webhookHandler({ onCompleted: (e) => { received = e; } })(request(EVENT, sign(EVENT)));
  assert.equal(response.status, 200);
  assert.equal(received.payment.netAmount, 4575);
  assert.equal(received.payment.reference, "cmd_1");
});

for (const [nom, signature] of [
  ["absente", null],
  ["mal formée", "n'importe quoi"],
  ["mauvais secret", sign(EVENT, undefined, "autre-secret")],
  ["trop ancienne", sign(EVENT, Math.floor(Date.now() / 1000) - 3600)],
]) {
  test(`signature ${nom} : 400 et aucune fonction appelée`, async () => {
    const pay = createTechnasPay({ secret: SECRET });
    const response = await pay.webhookHandler({ onCompleted: () => assert.fail("ne doit pas être appelée") })(request(EVENT, signature));
    assert.equal(response.status, 400);
  });
}

test("corps modifié après signature : refusé", async () => {
  const pay = createTechnasPay({ secret: SECRET });
  await assert.rejects(pay.verifyWebhook(EVENT.replace("5000", "9"), sign(EVENT)), WebhookVerificationError);
});

test("une fonction qui échoue fait échouer la réponse, pour que Technas relivre", async () => {
  const pay = createTechnasPay({ secret: SECRET });
  await assert.rejects(pay.webhookHandler({ onCompleted: () => { throw new Error("base en panne"); } })(request(EVENT, sign(EVENT))));
});

test("l'importer côté navigateur casse immédiatement", async () => {
  await assert.rejects(import("../dist/browser.js"), /côté serveur/);
});

test("createTestWebhook passe la vérification, et refuse un secret réel", async () => {
  const pay = createTechnasPay({ secret: SECRET });
  let received;
  const request = await pay.createTestWebhook("payment.completed", { reference: "cmd_9", amount: 5000, currency: "XOF", commission: 425 });
  const response = await pay.webhookHandler({ onCompleted: (e) => { received = e; } })(request);
  assert.equal(response.status, 200);
  assert.equal(received.payment.netAmount, 4575);
  const live = createTechnasPay({ secret: SECRET.replace("tps_test_", "tps_live_") });
  await assert.rejects(live.createTestWebhook("payment.failed", { reference: "r", amount: 1, currency: "XOF" }), (e) => e.code === "test_only");
});

test("listTransactions convertit les champs et transmet filtres et curseur", async () => {
  let url;
  const pay = createTechnasPay({
    secret: SECRET,
    baseUrl: "https://gw.test",
    fetch: async (u) => {
      url = u;
      return Response.json({ items: [{ id: "p1", reference: "c", amount: 5000, currency: "XOF", commission: 0, net_amount: 5000, status: "completed", created_at: "x" }], next_cursor: "suite" });
    },
  });
  const page = await pay.listTransactions({ limit: 10, status: "completed", cursor: "abc" });
  assert.equal(url, "https://gw.test/v1/transactions?limit=10&status=completed&cursor=abc");
  assert.equal(page.items[0].netAmount, 5000);
  assert.equal(page.nextCursor, "suite");
});

test("setPayoutDestination envoie le numéro et rend l'état par devise", async () => {
  const seen = [];
  const pay = createTechnasPay({
    secret: SECRET,
    baseUrl: "https://gw.test",
    fetch: async (url, init) => {
      seen.push({ url, init });
      return Response.json({
        destinations: [{
          currency: "XOF",
          current: { currency: "XOF", country: "TG", network: "moov_tg", phone: "+22891111111", beneficiary_name: "Boutique Awa", status: "active", effective_at: "2026-11-11T10:00:00Z" },
          pending: { currency: "XOF", country: "TG", network: "togocel", phone: "+22892222222", beneficiary_name: "Boutique Awa", status: "awaiting_confirmation", effective_at: null, confirm_expires_at: "2026-11-12T10:00:00Z" },
        }],
      }, { status: 202 });
    },
  });
  const etat = await pay.setPayoutDestination({ country: "TG", network: "togocel", phone: "+22892222222", beneficiaryName: "Boutique Awa" });
  assert.equal(seen[0].url, "https://gw.test/v1/payout-destination");
  assert.equal(seen[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(seen[0].init.body), { country: "TG", network: "togocel", phone: "+22892222222", beneficiary_name: "Boutique Awa" });
  const [xof] = etat.destinations;
  assert.equal(xof.current.phone, "+22891111111");
  assert.equal(xof.pending.status, "awaiting_confirmation");
  assert.equal(xof.pending.confirmExpiresAt, "2026-11-12T10:00:00Z");
});

test("getPayoutNetworks interroge le pays demandé", async () => {
  let url;
  const pay = createTechnasPay({ secret: SECRET, baseUrl: "https://gw.test", fetch: async (u) => ((url = u), Response.json([{ code: "moov_tg", name: "Moov", currency: "XOF" }])) });
  assert.deepEqual(await pay.getPayoutNetworks("TG"), [{ code: "moov_tg", name: "Moov", currency: "XOF" }]);
  assert.equal(url, "https://gw.test/v1/payout-networks?country=TG");
});

test("l'avis de changement de numéro arrive dans onPayoutDestination", async () => {
  const pay = createTechnasPay({ secret: SECRET });
  const body = JSON.stringify({
    id: "evt_2", type: "payout_destination.change_scheduled", created_at: "2026-11-11T10:00:00Z",
    data: { currency: "XOF", country: "TG", network: "togocel", phone: "+22892222222", beneficiary_name: "Boutique Awa", status: "scheduled", effective_at: "2026-11-13T10:00:00Z" },
  });
  let recu;
  const res = await pay.webhookHandler({ onPayoutDestination: (e) => (recu = e), onCompleted: () => assert.fail() })(request(body, sign(body)));
  assert.equal(res.status, 200);
  assert.equal(recu.destination.phone, "+22892222222");
  assert.equal(recu.destination.effectiveAt, "2026-11-13T10:00:00Z");
});

test("un type d'événement inconnu est acquitté, pas relivré", async () => {
  const pay = createTechnasPay({ secret: SECRET });
  const body = JSON.stringify({ id: "evt_3", type: "nouveau.type", created_at: "x", data: { a: 1 } });
  const res = await pay.webhookHandler({ onCompleted: () => assert.fail() })(request(body, sign(body)));
  assert.equal(res.status, 200);
});

test("getSettlements rend les frais du versement", async () => {
  const pay = createTechnasPay({ secret: SECRET, fetch: async () => Response.json([{ id: "s1", amount: 50000, fee: 1650, currency: "XOF", status: "completed", created_at: "x" }]) });
  const [r] = await pay.getSettlements();
  assert.equal(r.fee, 1650);
});

const PAYMENT_OK = { id: "p1", reference: "r", amount: 5000, currency: "XOF", commission: 100, net_amount: 4900, status: "pending", checkout_url: "https://c.test", metadata: {}, test_mode: true, created_at: "x" };

function payCapturingCurrency(extra = {}) {
  const sent = [];
  const pay = createTechnasPay({
    secret: SECRET,
    ...extra,
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return Response.json(PAYMENT_OK);
    },
  });
  return { pay, sent };
}

const ASK = { amount: 5000, reference: "r", returnUrl: "https://p.test" };

test("devise : celle passée à l'appel gagne toujours", async () => {
  const { pay, sent } = payCapturingCurrency({ defaultCurrency: "XAF" });
  await pay.askForPayment({ ...ASK, currency: "GHS", customer: { email: "a@b.co", name: "A", country: "CM" } });
  assert.equal(sent[0].currency, "GHS");
});

test("devise : sans currency, celle du pays du client (XOF à l'Ouest, XAF au Centre)", async () => {
  const { pay, sent } = payCapturingCurrency({ defaultCurrency: "GHS" });
  await pay.askForPayment({ ...ASK, customer: { email: "a@b.co", name: "A", country: "TG" } });
  await pay.askForPayment({ ...ASK, customer: { email: "a@b.co", name: "A", country: "cm" } });
  assert.deepEqual(sent.map((b) => b.currency), ["XOF", "XAF"]);
  assert.equal(sent[1].customer.country, "cm");
});

test("devise : hors zone CFA, jamais de devise locale déduite (le montant serait lu dans cette devise)", async () => {
  const { pay, sent } = payCapturingCurrency({ defaultCurrency: "XOF" });
  await pay.askForPayment({ ...ASK, customer: { email: "a@b.co", name: "A", country: "GH" } });
  assert.equal("currency" in sent[0], false); // Technas répond currency_conversion_unavailable
});

test("devise : sinon defaultCurrency quand le pays est inconnu", async () => {
  const { pay, sent } = payCapturingCurrency({ defaultCurrency: "xaf" });
  await pay.askForPayment({ ...ASK, customer: { email: "a@b.co", name: "A" } });
  assert.deepEqual(sent.map((b) => b.currency), ["XAF"]);
});

test("devise : sinon le montant seul part, le payeur choisira son pays", async () => {
  const sent = [];
  const pay = createTechnasPay({
    secret: SECRET,
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return Response.json({ ...PAYMENT_OK, currency: null, checkout_url: "https://pay-api.technas.fr/checkout/p1" });
    },
  });
  const p = await pay.askForPayment({ ...ASK, customer: { email: "a@b.co", name: "A" } });
  assert.equal("currency" in sent[0], false);
  assert.equal(p.currency, null);
  assert.equal(p.checkoutUrl, "https://pay-api.technas.fr/checkout/p1");
});

test("currencyForCountry couvre l'UEMOA et la CEMAC", () => {
  for (const c of ["BJ", "BF", "CI", "GW", "ML", "NE", "SN", "TG"]) assert.equal(currencyForCountry(c), "XOF");
  for (const c of ["CM", "CF", "CG", "GA", "GQ", "TD"]) assert.equal(currencyForCountry(c), "XAF");
  assert.equal(currencyForCountry("FR"), undefined);
  assert.equal(currencyForCountry("GH"), undefined);
  assert.equal(currencyForCountry(undefined), undefined);
});

test("une erreur détectée avant l'appel n'invite pas à réessayer", async () => {
  const pay = createTechnasPay({ secret: SECRET, fetch: () => assert.fail("aucun appel attendu") });
  await assert.rejects(
    pay.askForPayment({ amount: 1.5, currency: "XOF", reference: "r", customer: { email: "a@b.co", name: "A" }, returnUrl: "https://p.test" }),
    (e) => e.code === "invalid_amount" && e.retryable === false,
  );
});

const REFUND = { id: "rf1", payment_id: "p1", payment_reference: "cmd_1", amount: 5000, sent_amount: 5000, fee: 210, fees: "partner", balance_debit: 5210, currency: "XOF", status: "pending", failure: null, created_at: "x" };

test("refund : sans montant, frais au partenaire par défaut", async () => {
  const seen = [];
  const pay = createTechnasPay({ secret: SECRET, baseUrl: "https://gw.test", fetch: async (url, init) => (seen.push({ url, init }), Response.json(REFUND)) });
  const r = await pay.refund("p1");
  assert.equal(seen[0].url, "https://gw.test/v1/payments/p1/refunds");
  assert.equal(seen[0].init.method, "POST");
  assert.deepEqual(JSON.parse(seen[0].init.body), { fees: "partner" });
  assert.equal(r.balanceDebit, 5210);
  assert.equal(r.sentAmount, 5000);
  await pay.refund("p1", { amount: 2000, fees: "customer", reference: "geste-1" });
  assert.deepEqual(JSON.parse(seen[1].init.body), { amount: 2000, fees: "customer", reference: "geste-1" });
});

test("refund : montant ou frais invalides refusés avant tout appel", async () => {
  const pay = createTechnasPay({ secret: SECRET, fetch: () => assert.fail("aucun appel attendu") });
  await assert.rejects(pay.refund("p1", { amount: -5 }), (e) => e.code === "invalid_amount");
  await assert.rejects(pay.refund("p1", { amount: Number.NaN }), (e) => e.code === "invalid_amount");
  await assert.rejects(pay.refund("p1", { fees: "technas" }), (e) => e.code === "invalid_request");
});

test("insufficient_balance dit ce qui manque", async () => {
  const pay = createTechnasPay({
    secret: SECRET,
    fetch: async () => Response.json({ code: "insufficient_balance", message: "m", missing_amount: 310, currency: "XOF" }, { status: 409 }),
  });
  await assert.rejects(pay.refund("p1"), (e) =>
    e.code === "insufficient_balance" && e.details.missingAmount === 310 && e.details.currency === "XOF" && e.retryable === false);
});

test("topUpBalance ouvre une recharge", async () => {
  let seen;
  const pay = createTechnasPay({
    secret: SECRET, baseUrl: "https://gw.test",
    fetch: async (url, init) => ((seen = { url, init }), Response.json({ id: "t1", amount: 1000, currency: "XOF", status: "pending", checkout_url: "https://c.test", test_mode: true, created_at: "x" })),
  });
  const t = await pay.topUpBalance({ amount: 1000, currency: "XOF" });
  assert.equal(seen.url, "https://gw.test/v1/balance/top-ups");
  assert.deepEqual(JSON.parse(seen.init.body), { amount: 1000, currency: "XOF" });
  assert.equal(t.checkoutUrl, "https://c.test");
});

test("les webhooks refund.* et balance.topped_up arrivent dans onRefund et onTopUp", async () => {
  const pay = createTechnasPay({ secret: SECRET });
  const recus = [];
  const handler = pay.webhookHandler({ onRefund: (e) => recus.push(e), onTopUp: (e) => recus.push(e), onCompleted: () => assert.fail() });
  for (const [type, data] of [
    ["refund.failed", { ...REFUND, status: "failed", failure: "invalid_msisdn" }],
    ["balance.topped_up", { id: "t1", amount: 1000, currency: "XOF", completed_at: "y" }],
  ]) {
    const body = JSON.stringify({ id: `e-${type}`, type, created_at: "x", data });
    assert.equal((await handler(request(body, sign(body)))).status, 200);
  }
  assert.equal(recus[0].refund.failure, "invalid_msisdn");
  assert.equal(recus[0].refund.paymentReference, "cmd_1");
  assert.equal(recus[1].topUp.amount, 1000);
});

test("recordExternalRefund enregistre sans argent, et arrive dans onRefund", async () => {
  const seen = [];
  const pay = createTechnasPay({
    secret: SECRET, baseUrl: "https://gw.test",
    fetch: async (url, init) => (seen.push({ url, init }), Response.json({ ...REFUND, kind: "external", status: "completed", fee: 0, balance_debit: 0, method: "Flooz", note: "geste", recorded_by: "caisse" })),
  });
  const r = await pay.recordExternalRefund("p1", { amount: 2000, method: " Flooz ", note: "geste", recordedBy: "caisse" });
  assert.equal(seen[0].url, "https://gw.test/v1/payments/p1/external-refunds");
  assert.deepEqual(JSON.parse(seen[0].init.body), { amount: 2000, method: "Flooz", note: "geste", recorded_by: "caisse" });
  assert.equal(r.kind, "external");
  assert.equal(r.recordedBy, "caisse");
  await assert.rejects(pay.recordExternalRefund("p1", { amount: 2000, method: " " }), (e) => e.code === "invalid_request");

  const recus = [];
  const handler = createTechnasPay({ secret: SECRET }).webhookHandler({ onRefund: (e) => recus.push(e) });
  const body = JSON.stringify({ id: "e9", type: "refund.recorded", created_at: "x", data: { ...REFUND, kind: "external", method: "Espèces" } });
  assert.equal((await handler(request(body, sign(body)))).status, 200);
  assert.equal(recus[0].type, "refund.recorded");
  assert.equal(recus[0].refund.method, "Espèces");
});

test("getFxMode dit ce qui est ouvert hors zone CFA, et pourquoi pas", async () => {
  const pay = createTechnasPay({
    secret: SECRET, baseUrl: "https://gw.test",
    fetch: async (url) => (assert.equal(url, "https://gw.test/v1/fx"), Response.json({
      mode: "local", home_currency: "XOF",
      countries: [{ country: "GH", name: "Ghana", currency: "GHS", available: false, reason: "no_payout_number", rate: null, rate_source: null, rate_published_at: null, margin_pct: 0 }],
    })),
  });
  const fx = await pay.getFxMode();
  assert.equal(fx.mode, "local");
  assert.equal(fx.countries[0].reason, "no_payout_number");
});

test("un paiement hors zone porte le montant d'origine et le change", async () => {
  const body = JSON.stringify({
    id: "e-fx", type: "payment.completed", created_at: "x",
    data: { id: "p", reference: "r", status: "completed", amount: 121.96, currency: "GHS", commission: 2.44, net_amount: 119.52, metadata: {},
      original_amount: 5000, original_currency: "XOF",
      fx: { mode: "local", rate: 0.024392, franc_per_unit: 40.9973, margin_pct: 0, source: "Bank of Ghana", credited_currency: "GHS" } },
  });
  let recu;
  await createTechnasPay({ secret: SECRET }).webhookHandler({ onCompleted: (e) => (recu = e) })(request(body, sign(body)));
  assert.equal(recu.payment.amount, 121.96);
  assert.equal(recu.payment.originalAmount, 5000);
  assert.equal(recu.payment.fx.francPerUnit, 40.9973);
  assert.equal(recu.payment.fx.creditedCurrency, "GHS");
});

test("setFxMode : le risque doit être accepté explicitement", async () => {
  const seen = [];
  const pay = createTechnasPay({
    secret: SECRET, baseUrl: "https://gw.test",
    fetch: async (url, init) => {
      seen.push(JSON.parse(init.body));
      if (!JSON.parse(init.body).accept_risk) {
        return Response.json({ code: "risk_not_accepted", message: "m", risk: "Vous portez tout l'écart.", risk_version: "v" }, { status: 422 });
      }
      return Response.json({ mode: "local", home_currency: "XOF", markup_pct: 2, risk_accepted_at: "x", risk_version: "v", risks: {}, country_rules: { allowed: null, excluded: [] }, countries: [] });
    },
  });
  await assert.rejects(pay.setFxMode({ mode: "local" }), (e) => e.code === "risk_not_accepted" && e.details.risk === "Vous portez tout l'écart.");
  const fx = await pay.setFxMode({ mode: "local", acceptRisk: true, markupPct: 2 });
  assert.deepEqual(seen[1], { mode: "local", accept_risk: true, markup_pct: 2 });
  assert.equal(fx.markupPct, 2);
});

test("askForPayment : pays autorisés, exclus, et choix du pays avec devise imposée", async () => {
  const { pay, sent } = payCapturingCurrency();
  await pay.askForPayment({ ...ASK, currency: "XAF", askCountry: true, allowedCountries: ["CM", "GA"], excludedCountries: ["GA"], customer: { email: "a@b.co", name: "A" } });
  assert.equal(sent[0].currency, "XAF");
  assert.equal(sent[0].ask_country, true);
  assert.deepEqual(sent[0].allowed_countries, ["CM", "GA"]);
  assert.deepEqual(sent[0].excluded_countries, ["GA"]);
  await pay.askForPayment({ ...ASK, customer: { email: "a@b.co", name: "A" } });
  assert.equal("allowed_countries" in sent[1], false);
});

test("setCountryRules et les avis balance.converted, fx_mode.updated", async () => {
  let corps;
  const pay = createTechnasPay({ secret: SECRET, fetch: async (_u, init) => ((corps = JSON.parse(init.body)), Response.json({ allowed: ["TG"], excluded: [] })) });
  await pay.setCountryRules({ allowed: ["TG"] });
  assert.deepEqual(corps, { allowed: ["TG"], excluded: [] });
  const recus = [];
  const handler = createTechnasPay({ secret: SECRET }).webhookHandler({ onBalanceConverted: (e) => recus.push(e), onFxModeUpdated: (e) => recus.push(e) });
  for (const [type, data] of [
    ["balance.converted", { id: "c", from_currency: "GHS", from_amount: 100, to_currency: "XOF", gross_amount: 4000, cost: 80, credited_amount: 3920, effective_rate: 39.2 }],
    ["fx_mode.updated", { mode: "local", previous_mode: "none", markup_pct: 0, home_currency: "XOF" }],
  ]) {
    const body = JSON.stringify({ id: `e-${type}`, type, created_at: "x", data });
    assert.equal((await handler(request(body, sign(body)))).status, 200);
  }
  assert.equal(recus[0].conversion.creditedAmount, 3920);
  assert.equal(recus[1].fx.previousMode, "none");
});

test("expired : seul statut qui autorise une relance ; failed n'est pas définitif", () => {
  assert.equal(canRetry({ status: "expired" }), true);
  for (const status of ["failed", "pending", "completed", "amount_mismatch", "creating"]) {
    assert.equal(canRetry({ status }), false, status);
  }
  assert.equal(isFinal({ status: "failed" }), false);
  assert.equal(isFinal({ status: "pending" }), false);
  for (const status of ["completed", "expired", "amount_mismatch"]) assert.equal(isFinal({ status }), true);
});

test("payment.expired arrive dans onExpired, avec expiredAt ; failed dans onFailed seulement", async () => {
  const pay = createTechnasPay({ secret: SECRET });
  const vus = [];
  const handler = pay.webhookHandler({
    onFailed: (e) => vus.push(["failed", e.payment.status]),
    onExpired: (e) => vus.push(["expired", e.payment.status, e.payment.expiredAt, e.payment.reference]),
  });
  const body = JSON.stringify({
    id: "evt_x", type: "payment.expired", created_at: "2026-11-13T14:00:00Z",
    data: { id: "pay_x", reference: "BLX-1", status: "expired", amount: 300, currency: "XOF", commission: 6,
            net_amount: 294, metadata: {}, completed_at: null, expires_at: "2026-11-13T13:57:14Z",
            expired_at: "2026-11-13T14:00:00Z" },
  });
  assert.equal((await handler(request(body, sign(body)))).status, 200);
  assert.deepEqual(vus, [["expired", "expired", "2026-11-13T14:00:00Z", "BLX-1"]]);
  const test = await pay.createTestWebhook("payment.expired", { reference: "c2", amount: 1000, currency: "XOF" });
  assert.equal((await handler(test)).status, 200);
  assert.equal(vus[1][0], "expired");
  assert.ok(vus[1][2]);
});

test("getPayment rend expiresAt et expiredAt", async () => {
  const pay = createTechnasPay({
    secret: SECRET,
    fetch: async () => Response.json({ id: "p", reference: "r", amount: 300, currency: "XOF", commission: 6,
      net_amount: 294, status: "expired", checkout_url: null, metadata: {}, test_mode: true,
      created_at: "a", completed_at: null, expires_at: "b", expired_at: "c" }),
  });
  const p = await pay.getPayment("p");
  assert.deepEqual([p.status, p.expiresAt, p.expiredAt, canRetry(p)], ["expired", "b", "c", true]);
});

test("simulateTestPayment : la page de test sans navigateur, refusé avec un secret réel", async () => {
  const appels = [];
  const pay = createTechnasPay({
    secret: SECRET,
    fetch: async (url, init) => {
      appels.push([init.method, String(url), init.redirect]);
      if (String(url).includes("/test-checkout/")) return new Response("ok", { status: 200 });
      return Response.json({ id: "p1", reference: "r", amount: 1, currency: "XOF", commission: 0, net_amount: 1,
        status: "expired", metadata: {}, test_mode: true, created_at: "a" });
    },
  });
  const p = await pay.simulateTestPayment("p1", "expired");
  assert.equal(p.status, "expired");
  assert.deepEqual(appels[0], ["POST", "https://pay-api.technas.fr/test-checkout/p1/expired", "manual"]);
  assert.equal(appels[1][1], "https://pay-api.technas.fr/v1/payments/p1");
  const reel = createTechnasPay({ secret: "tps_live_pk_abc-DEF_123.ws_webhook-secret_456" });
  await assert.rejects(reel.simulateTestPayment("p1", "expired"), (e) => e.code === "test_only");
});

test("rejouer une référence expirée : payment_expired, pas de nouvel essai conseillé", async () => {
  const pay = createTechnasPay({
    secret: SECRET,
    fetch: async () => Response.json({ code: "payment_expired", message: "create a new payment with a NEW reference" }, { status: 409 }),
  });
  await assert.rejects(
    pay.askForPayment({ amount: 300, reference: "BLX-1", customer: { email: "a@b.co", name: "A" }, returnUrl: "https://p.example" }),
    (e) => e instanceof TechnasPayError && e.code === "payment_expired" && e.status === 409 && e.retryable === false,
  );
});

test("getFxMode rend les options ouvertes ; converted refusé avec fx_mode_unavailable", async () => {
  const pay = createTechnasPay({
    secret: SECRET,
    fetch: async (_url, init) => init.method === "PUT"
      ? Response.json({ code: "fx_mode_unavailable", message: "The converted mode is not open yet" }, { status: 422 })
      : Response.json({ mode: "none", available_modes: ["none", "local"], home_currency: "XOF", risks: {}, countries: [] }),
  });
  assert.deepEqual((await pay.getFxMode()).availableModes, ["none", "local"]);
  await assert.rejects(pay.setFxMode({ mode: "converted", acceptRisk: true }), (e) => e.code === "fx_mode_unavailable" && !e.retryable);
});

test("paiement par carte : décimales acceptées, devise obligatoire, method envoyée", async () => {
  let corps;
  const pay = createTechnasPay({
    secret: SECRET,
    fetch: async (_url, init) => {
      corps = JSON.parse(init.body);
      return Response.json({ id: "p1", reference: "c1", amount: 49.9, currency: "EUR", commission: 1.25, net_amount: 48.65, status: "pending", method: "card", checkout_url: "https://c.test", metadata: {}, test_mode: false, created_at: "x" });
    },
  });
  const p = await pay.askForPayment({ method: "card", amount: 49.9, currency: "eur", reference: "c1", customer: { email: "a@b.co", name: "A" }, returnUrl: "https://p.test/ok" });
  assert.equal(corps.method, "card");
  assert.equal(corps.amount, 49.9);
  assert.equal(corps.currency, "EUR");
  assert.equal(p.method, "card");
  await assert.rejects(
    pay.askForPayment({ method: "card", amount: 10, reference: "c2", customer: { email: "a@b.co", name: "A" }, returnUrl: "https://p.test" }),
    (e) => e.code === "currency_required",
  );
  await assert.rejects(
    pay.askForPayment({ amount: 10.5, currency: "XOF", reference: "c3", customer: { email: "a@b.co", name: "A" }, returnUrl: "https://p.test" }),
    (e) => e.code === "invalid_amount",
  );
});

test("le mobile money n'envoie pas de method (rétrocompatible) et lit method par défaut", async () => {
  let corps;
  const pay = createTechnasPay({
    secret: SECRET,
    fetch: async (_url, init) => {
      corps = JSON.parse(init.body);
      return Response.json({ id: "p1", reference: "r", amount: 5000, currency: "XOF", commission: 100, net_amount: 4900, status: "pending", checkout_url: "https://c.test", metadata: {}, test_mode: true, created_at: "x" });
    },
  });
  const p = await pay.askForPayment({ amount: 5000, currency: "XOF", reference: "r", customer: { email: "a@b.co", name: "A" }, returnUrl: "https://p.test" });
  assert.equal(corps.method, undefined);
  assert.equal(p.method, "mobile_money");
});

test("compte carte : inscription, état, tableau de bord, et l'erreur card_account_not_ready", async () => {
  const vus = [];
  const compte = { status: "onboarding", can_accept_payments: false, payouts_enabled: false, details_submitted: false, country: "FR", requirements: ["external_account"], disabled_reason: null, test_mode: true, updated_at: null };
  const pay = createTechnasPay({
    secret: SECRET,
    baseUrl: "https://gw.test",
    fetch: async (url, init) => {
      vus.push([init.method, new URL(url).pathname, init.body && JSON.parse(init.body)]);
      if (url.endsWith("/v1/card/onboarding")) return Response.json({ url: "https://connect.test/x", kind: "onboarding", expires_at: "t", account: compte });
      if (url.endsWith("/v1/card/account")) return Response.json(compte);
      if (url.endsWith("/v1/card/dashboard-link")) return Response.json({ url: "https://dash.test" });
      return Response.json({ code: "card_account_not_ready", message: "m", account_status: "onboarding" }, { status: 409 });
    },
  });
  const lien = await pay.startCardOnboarding({ country: "fr", returnUrl: "https://p.test/ok", refreshUrl: "https://p.test/again" });
  assert.equal(lien.kind, "onboarding");
  assert.deepEqual(vus[0], ["POST", "/v1/card/onboarding", { country: "FR", return_url: "https://p.test/ok", refresh_url: "https://p.test/again" }]);
  const etat = await pay.getCardAccount();
  assert.equal(etat.canAcceptPayments, false);
  assert.deepEqual(etat.requirements, ["external_account"]);
  assert.equal((await pay.getCardDashboardLink()).url, "https://dash.test");
  await assert.rejects(
    pay.askForPayment({ method: "card", amount: 10, currency: "EUR", reference: "c", customer: { email: "a@b.co", name: "A" }, returnUrl: "https://p.test" }),
    (e) => e.code === "card_account_not_ready" && e.details.accountStatus === "onboarding" && e.retryable === false,
  );
});

test("l'avis card_account.updated arrive dans onCardAccountUpdated", async () => {
  const body = JSON.stringify({ id: "evt_c", type: "card_account.updated", created_at: "x", data: { status: "enabled", can_accept_payments: true, payouts_enabled: true, details_submitted: true, country: "FR", requirements: [], disabled_reason: null, test_mode: false, updated_at: "y" } });
  let recu;
  const pay = createTechnasPay({ secret: SECRET });
  const res = await pay.webhookHandler({ onCardAccountUpdated: (e) => { recu = e; } })(request(body, sign(body)));
  assert.equal(res.status, 200);
  assert.equal(recu.account.canAcceptPayments, true);
  assert.equal(recu.account.status, "enabled");
});


test("Next : chaque appel part avec cache no-store, sans écraser méthode ni en-têtes", async () => {
  let init;
  const pay = createTechnasPay({ secret: SECRET, fetch: async (_u, i) => { init = i; return Response.json([]); } });
  await pay.getBalance();
  assert.equal(init.cache, "no-store");
  assert.equal(init.method, "GET");
  assert.ok(init.headers.Authorization.startsWith("Bearer "));
});

test("remboursement par carte : la normalisation vient du cœur @technas/pay (\"stripe\" ressort \"card\")", async () => {
  const coeur = await import("@technas/pay");
  const ici = await import("../dist/index.js");
  assert.equal(ici.normalizeRefundKind, coeur.normalizeRefundKind, "réexportée du cœur, pas recopiée");
  for (const recu of ["stripe", "card"]) {
    const pay = createTechnasPay({
      secret: SECRET, baseUrl: "https://gw.test",
      fetch: async () => Response.json({ ...REFUND, kind: recu, status: "completed", fee: 0, balance_debit: 0 }),
    });
    assert.equal((await pay.getRefund("rf1")).kind, "card", `lu depuis "${recu}"`);

    const recus = [];
    const handler = createTechnasPay({ secret: SECRET }).webhookHandler({ onRefund: (e) => recus.push(e) });
    const body = JSON.stringify({ id: `e-${recu}`, type: "refund.completed", created_at: "x", data: { ...REFUND, kind: recu } });
    assert.equal((await handler(request(body, sign(body)))).status, 200);
    assert.equal(recus[0].refund.kind, "card", `webhook depuis "${recu}"`);
  }
});

const KYC = {
  applies: true, stage: "soon", level: "none", days_elapsed: 24, warn_from_xof: 800000, warn_from_date: "2026-11-20T00:00:00Z",
  collected_xof: 812500, threshold_xof: 1000000, grace_days: 30, first_collected_at: "2026-10-22T09:00:00Z",
  deadline: "2026-11-21T09:00:00Z", waiver_until: null, blocked: false, reason: "amount", console_url: "https://console.test/kyc",
};

test("getAccountKyc lit GET /v1/account/kyc avec la clé d'API, et décode tous les champs", async () => {
  const vus = [];
  const pay = createTechnasPay({
    secret: SECRET, baseUrl: "https://gw.test",
    fetch: async (url, init) => { vus.push([init.method, new URL(url).pathname, init.headers.Authorization, init.body]); return Response.json(KYC); },
  });
  const kyc = await pay.getAccountKyc();
  assert.deepEqual(vus, [["GET", "/v1/account/kyc", "Bearer pk_abc-DEF_123", undefined]]);
  assert.deepEqual(kyc, {
    applies: true, stage: "soon", level: "none", daysElapsed: 24, warnFromXof: 800000, warnFromDate: "2026-11-20T00:00:00Z",
    collectedXof: 812500, thresholdXof: 1000000, graceDays: 30, firstCollectedAt: "2026-10-22T09:00:00Z",
    deadline: "2026-11-21T09:00:00Z", waiverUntil: null, blocked: false, reason: "amount", consoleUrl: "https://console.test/kyc",
  });
});

test("getAccountKyc : champs nuls gardés nuls, valeurs inconnues gardées telles quelles", async () => {
  const brut = { ...KYC, applies: false, stage: "nouvel_etat", level: "autre", days_elapsed: null, warn_from_date: null, first_collected_at: null, deadline: null, waiver_until: null, reason: null, collected_xof: 0 };
  const pay = createTechnasPay({ secret: SECRET, baseUrl: "https://gw.test", fetch: async () => Response.json(brut) });
  const kyc = await pay.getAccountKyc();
  assert.equal(kyc.stage, "nouvel_etat");
  assert.equal(kyc.level, "autre");
  for (const champ of ["daysElapsed", "warnFromDate", "firstCollectedAt", "deadline", "waiverUntil", "reason"]) assert.equal(kyc[champ], null, champ);
  assert.equal(kyc.applies, false);
  assert.equal(kyc.collectedXof, 0);
});

test("l'avis signé account.kyc_required arrive dans onKycRequired, avec un contenu typé", async () => {
  const body = JSON.stringify({ id: "evt_k", type: "account.kyc_required", created_at: "x", data: { reason: "amount_80", collected_xof: 812500, threshold_xof: 1000000, deadline: null, blocked: false, console_url: "https://console.test/kyc" } });
  let recu;
  const pay = createTechnasPay({ secret: SECRET });
  const res = await pay.webhookHandler({ onKycRequired: (e) => { recu = e; }, onCompleted: () => assert.fail() })(request(body, sign(body)));
  assert.equal(res.status, 200);
  assert.deepEqual(recu, {
    id: "evt_k", type: "account.kyc_required", createdAt: "x",
    kyc: {
      reason: "amount_80", collectedXof: 812500, thresholdXof: 1000000, deadline: null, blocked: false, consoleUrl: "https://console.test/kyc",
      stage: null, blockReason: null, daysElapsed: null, graceDays: null, firstCollectedAt: null,
    },
  });
});

test("l'avis account.kyc_required lit stage, blockReason, daysElapsed, graceDays, firstCollectedAt", async () => {
  const body = JSON.stringify({ id: "evt_k2", type: "account.kyc_required", created_at: "x", data: {
    reason: "blocked", collected_xof: 400000, threshold_xof: 1000000, deadline: "2026-12-01T00:00:00Z", blocked: true,
    console_url: "https://console.test/kyc", stage: "blocked", block_reason: "duration", days_elapsed: 31, grace_days: 30,
    first_collected_at: "2026-10-31T09:00:00Z",
  } });
  let recu;
  const pay = createTechnasPay({ secret: SECRET });
  const res = await pay.webhookHandler({ onKycRequired: (e) => { recu = e; } })(request(body, sign(body)));
  assert.equal(res.status, 200);
  assert.deepEqual(recu.kyc, {
    reason: "blocked", collectedXof: 400000, thresholdXof: 1000000, deadline: "2026-12-01T00:00:00Z", blocked: true,
    consoleUrl: "https://console.test/kyc", stage: "blocked", blockReason: "duration", daysElapsed: 31, graceDays: 30,
    firstCollectedAt: "2026-10-31T09:00:00Z",
  });
});

test("kyc_required et contract_required (409) : consoleUrl, reason, version dans details, jamais à réessayer", async () => {
  let corps;
  const pay = createTechnasPay({ secret: SECRET, baseUrl: "https://gw.test", fetch: async () => Response.json(corps, { status: 409 }) });
  corps = { code: "kyc_required", message: "m", console_url: "https://console.test/kyc", reason: "duration" };
  await assert.rejects(pay.askForPayment(ASK), (e) =>
    e instanceof TechnasPayError && e.code === "kyc_required" && e.status === 409 && e.retryable === false
    && e.details.consoleUrl === "https://console.test/kyc" && e.details.reason === "duration");
  corps = { code: "contract_required", message: "m", console_url: "https://console.test/contrat", version: "2026-11" };
  await assert.rejects(pay.askForPayment(ASK), (e) =>
    e.code === "contract_required" && e.retryable === false && e.details.version === "2026-11" && e.details.consoleUrl === "https://console.test/contrat");
});

test("Next : getAccountKyc passe par le cœur avec cache: no-store", async () => {
  let init;
  const pay = createTechnasPay({ secret: SECRET, baseUrl: "https://gw.test", fetch: async (_u, i) => { init = i; return Response.json(KYC); } });
  assert.equal((await pay.getAccountKyc()).thresholdXof, 1000000);
  assert.equal(init.cache, "no-store");
});

test("le client change d'offre après expiration : nouvel essai, jamais l'ancienne référence", async () => {
  const sent = [];
  const paiements = new Map();
  const corps = (p) => ({ ...p, currency: "XOF", commission: 0, net_amount: p.amount, metadata: {}, test_mode: true, created_at: "x" });
  const pay = createTechnasPay({
    secret: SECRET,
    baseUrl: "https://gw.test",
    fetch: async (url, init = {}) => {
      const path = new URL(url).pathname;
      const method = init.method ?? "GET";
      if (method === "POST" && path === "/v1/payments") {
        const b = JSON.parse(init.body);
        sent.push({ reference: b.reference, amount: b.amount });
        const deja = [...paiements.values()].find((p) => p.reference === b.reference);
        if (deja && deja.amount !== b.amount) return Response.json({ code: "reference_conflict", message: "m" }, { status: 409 });
        if (deja && deja.status === "expired") return Response.json({ code: "payment_expired", message: "m" }, { status: 409 });
        if (deja) return Response.json(corps(deja));
        const p = { id: `pay_${paiements.size + 1}`, reference: b.reference, amount: b.amount, status: "pending", checkout_url: "https://c.test" };
        paiements.set(p.id, p);
        return Response.json(corps(p), { status: 201 });
      }
      const sim = path.match(/^\/test-checkout\/([^/]+)\/(\w+)$/);
      if (sim) {
        const p = paiements.get(sim[1]);
        p.status = sim[2];
        if (p.status === "expired") p.checkout_url = null;
        return Response.json(corps(p));
      }
      const lu = path.match(/^\/v1\/payments\/([^/]+)$/);
      if (lu) return Response.json(corps(paiements.get(lu[1])));
      return assert.fail(`appel inattendu ${method} ${path}`);
    },
  });
  const demande = { customer: { email: "a@b.co", name: "A" }, returnUrl: "https://p.test/retour" };

  const essai1 = await pay.askForPayment({ ...demande, amount: 5000, reference: retryReference("F", 1) });
  await pay.simulateTestPayment(essai1.id, "expired");
  const relu = await pay.getPayment(essai1.id);
  assert.equal(relu.status, "expired");
  assert.ok(canRetry(relu));

  const essai2 = await pay.askForPayment({ ...demande, amount: 7500, reference: retryReference("F", 2) });
  assert.equal(essai2.status, "pending");
  assert.notEqual(essai2.id, essai1.id);

  await assert.rejects(
    pay.askForPayment({ ...demande, amount: 7500, reference: retryReference("F", 1) }),
    (e) => e instanceof TechnasPayError && e.code === "reference_conflict" && e.status === 409 && e.retryable === false,
  );
  assert.deepEqual(sent, [
    { reference: "F-1", amount: 5000 },
    { reference: "F-2", amount: 7500 },
    { reference: "F-1", amount: 7500 },
  ]);
});
