import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { createTechnasPay, TechnasPayError, WebhookVerificationError } from "../dist/index.js";

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
