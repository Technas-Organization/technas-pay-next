# @technas/pay-next : règles pour un agent de code

Consignes pour un assistant de code. Appliquez-les dans l'application de l'utilisateur, pas dans ce dépôt. Le README détaille chaque fonction. Un exemple complet se trouve dans [`example/`](example).

## Avant de commencer

1. L'application doit utiliser Next.js 13.4+ avec App Router. Sinon, utilisez `pay.verifyWebhook` (voir le README).
2. `TECHNAS_PAY_SECRET` doit exister dans l'environnement serveur ou dans `.env.local`, et commencer par `tps_test_`. S'il manque, demandez-le à l'utilisateur. **N'en inventez pas, ne l'affichez pas, ne le commitez pas.** Vérifiez que `.env.local` est ignoré par git.
3. Repérez le modèle de commande : il faut une référence unique, un montant calculé côté serveur, un état « payée », et une colonne pour garder `payment.id` (nécessaire pour rembourser).

## Quelle méthode pour quoi

| Besoin | Appel |
|---|---|
| Faire payer une commande | `pay.askForPayment({ amount, reference, customer: { email, name }, returnUrl })`, puis `redirect(checkoutUrl)` |
| Savoir qu'elle est payée | webhook `onCompleted`, dans `app/api/technas-pay/route.ts` |
| Rattraper un webhook manqué | `pay.getPaymentByReference(reference)` |
| Annuler un paiement que personne n'a commencé à payer (autre offre) | `pay.cancelPayment(id)` → paiement `expired`, `checkoutUrl` null, `canceledAt` |
| Savoir si on peut relancer le client | webhook `onExpired` (`payment.expired`), ou `canRetry(await pay.getPayment(id))` |
| Rembourser un client | `pay.refund(paymentId, { amount?, fees?, reference? })` |
| Noter un remboursement fait hors Technas (Flooz, T-Money, espèces) | `pay.recordExternalRefund(paymentId, { amount, method, note?, recordedBy? })` |
| Savoir que le remboursement est arrivé | webhook `onRefund` (`refund.completed`, `refund.failed` ou `refund.recorded`) |
| Recharger le solde pour rembourser | `pay.topUpBalance({ amount, currency })`, puis ouvrir `checkoutUrl` ; webhook `onTopUp` |
| Afficher le solde | `pay.getBalance()` |
| Savoir quels pays hors zone CFA sont ouverts, et les risques | `pay.getFxMode()` |
| Activer une option hors zone CFA (après accord explicite de l'utilisateur) | `pay.setFxMode({ mode, acceptRisk: true, markupPct? })` |
| Choisir les pays où vendre | `pay.setCountryRules({ allowed?, excluded? })`, ou `allowedCountries` / `excludedCountries` par paiement |
| Afficher l'historique | `pay.listTransactions({ limit, status, cursor })` |
| Reversements, numéro de reversement | `pay.getSettlements()`, `pay.getPayoutDestination()`, `pay.setPayoutDestination(...)` |
| Faire payer par carte bancaire | d'abord un compte carte actif (section « Paiement par carte »), puis `pay.askForPayment({ method: "card", amount, currency, ... })` |
| Ouvrir ou finir le compte carte | `pay.startCardOnboarding({ country, returnUrl, refreshUrl })`, puis rediriger le RESPONSABLE vers `url` |
| Savoir si la carte est ouverte | `(await pay.getCardAccount()).canAcceptPayments`, ou webhook `onCardAccountUpdated` |
| Afficher au marchand son seuil d'identité | `pay.getAccountKyc()` ; webhook `onKycRequired` (`account.kyc_required`) pour prévenir le responsable |
| Tableau de bord carte (virements, banque, litiges) | `pay.getCardDashboardLink()` → tableau de bord du compte carte, identifiants du responsable |
| Tester la route webhook | `pay.createTestWebhook(type, paiement)` |
| Jouer le payeur en test (réussi, refusé, expiré) | `pay.simulateTestPayment(id, "completed" \| "failed" \| "expired")` |
| Le client change d'offre ou revient plus tard | `pay.cancelPayment(ancienId)`, puis nouvel essai `retryReference(factureId, n + 1)` ; au retour, `pay.getPayment(dernierPaymentId)` d'abord (section « Le client change d'offre ou revient plus tard ») |

## Étapes

1. `npm install github:Technas-Organization/technas-pay-next#v0.13.0`
2. Créez `lib/pay.ts` :
   ```ts
   import { createTechnasPay } from "@technas/pay-next";

   export const pay = createTechnasPay({ secret: process.env.TECHNAS_PAY_SECRET! });
   ```
3. Dans une Server Action, relisez la commande en base, appelez `pay.askForPayment(...)`, gardez `payment.id` sur la commande, puis `redirect(checkoutUrl)`.
4. Créez `app/api/technas-pay/route.ts` :
   ```ts
   export const POST = pay.webhookHandler({ onCompleted, onFailed, onExpired, onRefund, onTopUp });
   ```
   Dans `onCompleted`, marquez la commande payée à partir de `event.payment.reference`.
5. Ajoutez un test avec `pay.createTestWebhook`, puis lancez-le.

## App mobile (Flutter)

Ne réécrivez pas de routes : `export const { GET, POST } = pay.appRoutes({ authorize, resolveOrder, returnUrl, webhooks, card?, authorizeAdmin? }).nextHandlers("/api/technas-pay")` dans `app/api/technas-pay/[...path]/route.ts`. `resolveOrder(orderId, user)` relit la commande EN BASE et rend `null` si elle n'est pas à cet utilisateur. Routes : `GET /methods`, `POST /payments`, `GET /payments/{id}`, `POST /payments/{id}/cancel`, `POST /webhook` (toutes servies par ces `GET` et `POST`). Le client change d'offre : l'app appelle `POST /payments/{id}/cancel` sur l'essai affiché, puis `POST /payments` ; si la commande a changé de montant, `POST /payments` annule lui-même l'ancien essai encore ouvert (`payment_in_progress` ou `payment_already_completed`, 409 : aucun second paiement). Côté app : `TechnasPayClient(baseUrl: '.../api/technas-pay')`.

## Obligatoire

- **`amount`** : en unité principale (`5000` = 5 000 FCFA, `12.5` = 12,50 €, jamais × 100), calculé côté serveur. Entier pour le mobile money ; décimales seulement par carte.
- **`reference`** : l'identifiant unique de la commande.
- **`customer.email`** et **`customer.name`** : de vrais champs du client, jamais inventés.
- **`returnUrl`** : la page de retour, en https en production.
- Le reste est facultatif. Passez `customer.country` et `customer.phone` si l'application les connaît : ils évitent au client de choisir son pays.

## La devise est automatique

- **Ne passez pas `currency`** si l'application vend en francs CFA.
  - La devise suit le pays du client : TG → XOF, CM → XAF, pour le même montant.
  - Sans pays, le client choisit le sien sur la page de paiement.
- **Ne fixez pas `defaultCurrency`** : il empêcherait ce choix.
- **Hors zone, les montants peuvent avoir des centimes** (`121.96` GHS) : stockez-les en décimal, ne les arrondissez pas.
- Dans le webhook, `event.payment.originalAmount` est le montant demandé en F CFA ; `amount` et `currency` sont ce qui a été payé.

## Où vendre (tout est facultatif)

- **Le client choisit son pays** : sans `currency` ni `customer.country`, la page le lui demande.
- **Pays fixé** : `customer.country`.
- **Pour tout le compte** : `pay.setCountryRules({ allowed, excluded })`. Codes ISO à deux lettres.
- **Pour un seul paiement** : `allowedCountries` / `excludedCountries` dans `askForPayment`.
- **Devise imposée** : `currency: "XAF"` ; ajoutez `askCountry: true` pour que le client choisisse parmi les pays de cette devise.
- **Pays refusé** : `country_not_allowed`. Ne contournez pas ce refus : c'est le choix du marchand.

## Clients hors zone franc CFA : une option à risque, décidée par l'utilisateur

- **Montant** : il reste en F CFA, ne passez pas `currency`.
- **C'est une option** : `pay.getFxMode()` dit laquelle est active, quels pays sont ouverts, et ce qui manque à chacun (`reason`).
- **Technas ne couvre aucun risque de change.** Avant d'activer `local` ou `converted` :
  1. lisez `(await pay.getFxMode()).risks[mode]` (et `risks.markup` si un supplément est prévu) ;
  2. **montrez ce texte à l'utilisateur, en entier, et expliquez-le simplement** : ce qu'il peut perdre, dans quelle monnaie il sera payé, quel numéro de reversement il lui faut ;
  3. attendez son accord explicite, en toutes lettres ;
  4. seulement ensuite, appelez `pay.setFxMode({ mode, acceptRisk: true, markupPct? })`.
- **N'activez jamais une option de vous-même**, et ne passez jamais `acceptRisk: true` sans cet accord.
- **`local`** : le solde est tenu et reversé dans la monnaie du client. Il faut un numéro de reversement **confirmé** dans cette monnaie (`setPayoutDestination`, réservé à un administrateur), sinon le pays reste fermé (`no_payout_number`).
- **`converted`** : PAS ENCORE OUVERT. `setFxMode({ mode: "converted" })` lève `fx_mode_unavailable` : ne le proposez pas. Seules les options de `(await pay.getFxMode()).availableModes` existent (aujourd'hui `none` et `local`).
- **`markupPct`** (0 à 20) : supplément payé par le client, affiché, qui revient au marchand.
- **Ne promettez jamais** un pays que `getFxMode()` ne donne pas `available: true`.
- **Webhooks** :
  - branchez `onFxModeUpdated` : un changement d'option que l'utilisateur n'a pas fait signale une clé compromise ;
  - branchez `onBalanceConverted` en mode `converted`.

## Sécurité

- **Le secret reste côté serveur.**
  - N'importez jamais `lib/pay.ts` dans un fichier `"use client"`.
  - Pas de préfixe `NEXT_PUBLIC_`.
  - Jamais de secret dans le code du navigateur, une page, un log ou un commit.
- **Vérifiez la signature de chaque webhook avec le bon secret.**
  - `webhookHandler` (ou `verifyWebhook`) le fait, avec le secret passé à `createTechnasPay`.
  - Un secret `tps_test_` ne vérifie que les webhooks de test, un secret `tps_live_` que ceux du réel.
  - Le serveur qui reçoit les webhooks réels doit avoir le secret `tps_live_`.
  - Ne contournez jamais un refus de signature (réponse 400).
- **Conservez le corps brut** : `webhookHandler` le lit lui-même. Ne le passez pas par `request.json()` avant.
- **Seul le webhook prouve le paiement.** Ne marquez jamais une commande payée depuis la page `returnUrl`.
- **Réservez à un administrateur** les remboursements et le numéro de reversement. Ne les exposez jamais sur une page publique.

## La règle de relance (à respecter strictement)

**Une référence = un essai. Relancez avec une NOUVELLE référence seulement après `payment.expired` (ou `getPayment` → `expired`), jamais sur `failed`.**

- Ne prenez pas l'identifiant de commande tel quel comme `reference` : composez `${orderId}-${tentative}` (`retryReference(orderId, tentative)`) et gardez la tentative en base, pour pouvoir en créer une nouvelle.
- Rejouer la référence d'un paiement expiré lève `payment_expired` (409) : ne réessayez pas le même appel, créez une nouvelle référence.
- Après expiration, `checkoutUrl` vaut `null` : n'envoyez jamais l'ancien lien au client.

- `failed` n'est **pas** définitif : le client peut encore payer sur la même page pendant une heure, et `onCompleted` arriver ensuite. Dans `onFailed`, ne marquez pas la commande annulée, n'envoyez pas de nouveau lien.
- `expired` est définitif : le lien est fermé, Technas a vérifié chez l'opérateur que rien n'a été payé ni n'est en cours. `canRetry(payment)` vaut `true` seulement là.
- La même référence rend le même paiement expiré : générez-en une nouvelle (ex. `${orderId}-2`) et gardez le nouveau `payment.id`.
- Expliquez cette règle à l'utilisateur : un client relancé sur `failed` pourrait payer deux fois.

## Le client change d'offre ou revient plus tard

La règle de relance vise VOS relances. Quand c'est le client qui revient ou choisit une autre offre, c'est un nouvel essai, jamais un refus « un paiement existe déjà ».

- **Une référence = un essai.** Nouvelle offre, ou retour après expiration : un NOUVEL essai, avec une nouvelle référence `retryReference(factureId, n + 1)` (`n` gardé en base). Réutiliser la référence d'un autre montant lève `reference_conflict` (409) ; celle d'un essai expiré, `payment_expired` (409). Les routes toutes faites (`appRoutes`) le font seules.
- **Une facture n'est payée QUE sur `payment.completed`** (avis signé, `onCompleted`). Jamais sur `returnUrl`, jamais à l'ouverture de la page.
- **Un essai non payé ne bloque jamais un nouvel essai.** Même offre et essai `pending` ou `failed` : renvoyez le client sur la même page (`checkoutUrl`). Autre offre : ANNULEZ l'ancien essai (`pay.cancelPayment(ancienId)`), puis créez le nouveau avec une NOUVELLE référence ; ne refusez pas. `expired` : marquez la tentative expirée et laissez recommencer.
- **`cancelPayment` refuse quand c'est trop tard** : `payment_already_completed` (le client a payé l'ancienne offre : relisez le paiement, ne créez rien) ; `payment_in_progress` (une demande est en cours chez l'opérateur : ne créez PAS de second paiement, attendez l'avis de l'issue). Un paiement annulé reste `expired` (`canRetry` vaut `true`), avec `canceledAt` et `cancelReason` ; son avis `payment.expired` porte `reason` = `canceled` (`timeout` pour un lien expiré, `null` dans un avis ancien).
- **Au retour du client**, vérifiez avec `pay.getPayment(dernierPaymentId)` avant de dire quoi que ce soit ; ne vous fiez jamais seulement à votre propre base.
- **Un ancien essai payé APRÈS le nouveau** (le client a payé les deux pages) : n'activez rien deux fois ; remboursez l'essai en trop avec `pay.refund(paymentId)`.

Avec l'App Router :

```ts
// app/factures/actions.ts : au clic « Payer » (Server Action)
"use server";
import { redirect } from "next/navigation";
import { retryReference } from "@technas/pay-next";
import { pay } from "@/lib/pay";

export async function payer(factureId: string, offreId: string) {
  const facture = await db.facture.findUniqueOrThrow({ where: { id: factureId } });
  const offre = await db.offre.findUniqueOrThrow({ where: { id: offreId } }); // montant lu EN BASE
  if (facture.dernierPaymentId) {
    const dernier = await pay.getPayment(facture.dernierPaymentId); // Technas, pas seulement la base
    if (dernier.status === "completed") redirect(`/factures/${factureId}`); // déjà payée
    const memeOffre = dernier.amount === offre.montant;
    if (memeOffre && dernier.status !== "expired" && dernier.checkoutUrl) {
      redirect(dernier.checkoutUrl); // pending ou failed : même page, le client peut encore payer
    }
    if (dernier.status !== "expired") {
      // Autre offre : l'ancien lien est fermé d'abord. payment_in_progress (demande en cours chez
      // l'opérateur) et payment_already_completed (il vient d'être payé) remontent : on ne crée
      // alors AUCUN second paiement.
      await pay.cancelPayment(dernier.id);
    }
  }
  // Ancien essai annulé ou expiré : un NOUVEL essai, avec une nouvelle référence.
  const n = facture.essais + 1;
  const p = await pay.askForPayment({
    amount: offre.montant,
    reference: retryReference(factureId, n),
    customer: { email: facture.email, name: facture.nom },
    returnUrl: `${process.env.SITE_URL}/factures/${factureId}`,
    metadata: { facture_id: factureId },
  });
  await db.facture.update({ where: { id: factureId }, data: { essais: n, dernierPaymentId: p.id } });
  redirect(p.checkoutUrl!);
}

// app/api/technas-pay/route.ts : la facture n'est payée QU'ici
export const POST = pay.webhookHandler({
  async onCompleted(event) {
    const id = String(event.payment.metadata.facture_id);
    const facture = await db.facture.findUniqueOrThrow({ where: { id } });
    if (facture.payeePar && facture.payeePar !== event.payment.id) {
      await pay.refund(event.payment.id); // l'autre page a aussi été payée : rembourser celle-ci
      return;
    }
    await db.facture.update({ where: { id }, data: { payeePar: event.payment.id, montantPaye: event.payment.amount } });
  },
});
```

## Webhooks

- **Ils peuvent arriver plusieurs fois** : vos fonctions doivent le supporter. Vérifiez l'état en base, ou gardez `event.id`.
- **Ne rattrapez pas leurs erreurs pour répondre 200.** Une erreur doit remonter pour que le webhook soit relivré.
- **`onFailed` n'est pas définitif** : `onCompleted` peut arriver après.
- **`onExpired` est définitif** : seul moment où relancer le client (nouvelle référence).
- **`onRefund`** : prévenez le client, par e-mail ou SMS. Technas ne lui écrit pas.
  - `refund.completed` : l'argent est arrivé, `sentAmount` sur son téléphone.
  - `refund.failed` : rien n'est parti et votre solde est recrédité. Proposez un autre moyen, ou refaites le même appel `refund` : il est permis après un échec.
- **`onKycRequired`** : seuil d'identité proche ou atteint. Prévenez le responsable du compte (`event.kyc.consoleUrl`), pas le client.

## Paiement par carte (`method: "card"`)

Ce n'est PAS le même parcours que le mobile money. Ne le proposez que si l'utilisateur le demande.

1. **Un compte carte d'abord, une seule fois.** Ajoutez dans les réglages de l'application un bouton « Activer le paiement par carte », réservé au responsable du compte. Au clic, côté serveur :
   ```ts
   const { url } = await pay.startCardOnboarding({ country: "FR", returnUrl: `${site}/reglages/carte?fin=1`, refreshUrl: `${site}/reglages/carte?relance=1` });
   redirect(url);
   ```
   - `country` est le pays de l'UTILISATEUR (pas de ses clients). Demandez-le-lui, ne le devinez pas.
   - Le lien expire en quelques minutes : générez-le au clic, ne l'envoyez jamais par e-mail.
   - Sur `refreshUrl`, rappelez `startCardOnboarding` et redirigez à nouveau.
   - Sur `returnUrl`, affichez `await pay.getCardAccount()` : `status` dit où il en est (`onboarding`, `under_review`, `restricted`, `enabled`) et `requirements` ce qui manque.
   - Le responsable s'inscrit sur la page sécurisée de notre partenaire carte (Stripe), qui vous fera accepter son contrat : il y donne son identité et sa banque. Ni vous ni Technas ne voyez son IBAN.
2. **Proposer la carte seulement si `canAcceptPayments` est vrai.** Gardez l'état en base via `onCardAccountUpdated`, ou relisez `getCardAccount()`. Sinon, ne montrez que le mobile money.
3. **Faire payer :** `pay.askForPayment({ method: "card", amount: 49.9, currency: "EUR", reference, customer, returnUrl })`, puis `redirect(checkoutUrl)`. `currency` est obligatoire par carte. Le reste est identique : même webhook `onCompleted`, même règle « une référence = un essai », même `payment.expired` au bout d'une heure.
4. **L'argent va directement sur le compte carte de l'utilisateur**, commission Technas déjà retirée. Il n'apparaît PAS dans `getBalance()` et ne passe pas par les reversements. Les virements vers sa banque se règlent dans son tableau de bord carte (`getCardDashboardLink()`).
5. **Rembourser :** le même `pay.refund(paymentId, { amount? })`. La carte est remboursée depuis son compte carte (`refund.kind === "card"`), sans toucher au solde Technas ; `fees` est sans objet. La commission n'est pas rendue.
6. **Erreur `card_account_not_ready` (409)** : le compte n'encaisse pas encore. `error.details.accountStatus` dit pourquoi. Ne réessayez pas : proposez le mobile money, ou renvoyez le responsable vers `startCardOnboarding`.
7. **En test** (`tps_test_`), la carte de test `4242 4242 4242 4242`, une date future et n'importe quel code valident le paiement ; l'inscription de test accepte des données fictives.

## Rembourser

- **Appel** : `pay.refund(paymentId)` rembourse tout ce qui reste ; `pay.refund(paymentId, { amount })` rembourse une partie.
- **Destination** : l'argent repart au numéro qui a payé, jamais à un autre.
- **Plafond** : le total remboursé ne dépasse jamais le montant payé.
- **Commission** : la commission Technas n'est pas rendue.
- **Frais du renvoi**, choisis à chaque appel avec `fees` :
  - `"partner"` (défaut) : le client reçoit tout, les frais sont pris en plus sur votre solde ;
  - `"customer"` : les frais sont retirés de ce qu'il reçoit (`sentAmount`).
- **Idempotence** : rejouer le même appel ne rembourse pas deux fois. Pour deux remboursements partiels identiques et voulus, donnez à chacun sa `reference`, par exemple l'identifiant de la décision.
- **Statut** : la réponse peut être `pending`. Le résultat arrive dans `onRefund`, ou par `pay.getRefund(id)`.
- **Solde insuffisant** : l'erreur `insufficient_balance` donne `error.details.missingAmount`. Rechargez avec `pay.topUpBalance`, puis rappelez `refund`.
- **Remboursement fait hors Technas** (Flooz, T-Money, espèces) : `pay.recordExternalRefund(paymentId, { amount, method })`.
  - Aucun argent ne bouge, le solde ne change pas.
  - Il compte dans le même plafond que `refund`.
  - Même idempotence, webhook `refund.recorded`.
  - N'appelez jamais `refund` pour un remboursement déjà fait à la main : le client serait remboursé deux fois.
- **Total remboursé** : `payment.refundedAmount` additionne les deux sortes.

## Seuil d'identité

En réel, un compte sans pièce d'identité vérifiée voit ses NOUVEAUX paiements mobile money refusés (`kyc_required`, 409) au-delà de 1 000 000 F CFA encaissés en cumul, ou 30 jours après son premier paiement réel encaissé. Rien de ce qui existe n'est bloqué : paiement en cours, remboursement, reversement, lecture. La carte n'est pas concernée. Le responsable du compte dépose sa pièce dans la console (`consoleUrl`).

- **Afficher l'état au MARCHAND** (jamais au client final), dans un composant serveur ou une route : `await pay.getAccountKyc()` rend `stage` (`ok`, `soon`, `blocked`, `verified`, `not_applicable`), `collectedXof`, `thresholdXof`, `graceDays`, `deadline`, `reason` et `consoleUrl`. Une valeur inconnue de `stage` arrive telle quelle : affichez-la sans planter.
- **Prévenir le responsable** : ajoutez `onKycRequired` à la route webhook (avis `account.kyc_required`, envoyé à 80 % du seuil, 7 jours avant l'échéance, puis au premier refus). `event.kyc.reason` vaut `amount_80`, `deadline_7d` ou `blocked` ; `event.kyc` porte aussi `stage`, `blockReason` (`amount`, `duration`), `daysElapsed`, `graceDays` et `firstCollectedAt`, comme `getAccountKyc()` (`null` sur un avis plus ancien).
- **Sur `kyc_required`** : ne réessayez jamais. Proposez la carte si elle est ouverte, sinon expliquez au client que le paiement mobile money n'est pas disponible pour le moment.
- **Les chiffres (1 000 000, 30) viennent de l'API** (`thresholdXof`, `graceDays`) : ne les écrivez jamais en dur dans le code.

## Erreurs

- `kyc_required` (409) : nouveau paiement mobile money refusé tant que la pièce d'identité n'est pas vérifiée. `error.details.consoleUrl` (où le responsable la dépose) et `error.details.reason` (`amount` ou `duration`). Pas à réessayer : voir « Seuil d'identité ».
- `contract_required` (409) : le responsable doit accepter le contrat `error.details.version` dans la console (`error.details.consoleUrl`). Pas à réessayer.
- `card_account_not_ready` (409) : paiement par carte demandé sans compte carte actif. Voir « Paiement par carte ».
- `card_payments_unavailable` (503) : la carte n'est pas encore ouverte chez Technas. Proposez le mobile money.
- `currency_required` : `method: "card"` sans `currency`.

`error.code`, avec `error.retryable` (vrai : refaites **le même appel**, mêmes valeurs) et `error.details`.

| `error.code` | Que faire |
|---|---|
| `invalid_secret` | Variable absente ou mal copiée : demandez à l'utilisateur de la vérifier |
| `invalid_api_key` | Secret refusé : contacter Technas |
| `invalid_request` | Corriger le champ indiqué dans `error.errors` |
| `invalid_amount`, `amount_too_low` | Montant entier positif, assez grand pour couvrir les frais |
| `currency_not_enabled` | Devise non ouverte sur ce compte : contacter Technas |
| `currency_conversion_unavailable` | Client hors zone CFA, mode de change `none` : ne pas proposer ce pays ; voir `getFxMode()` |
| `kyc_required` | Pièce d'identité à vérifier : ne pas réessayer ; proposer la carte, ou dire au client que le mobile money n'est pas disponible pour le moment ; prévenir le responsable (`error.details.consoleUrl`) |
| `contract_required` | Le responsable accepte le contrat `error.details.version` dans la console (`error.details.consoleUrl`) ; ne pas réessayer |
| `country_not_allowed` | Le marchand ne vend pas dans ce pays : ne pas le proposer |
| `country_not_available` | Pays pas prêt : `error.details.reason` dit quoi (`no_payout_number`…) |
| `risk_not_accepted` | Montrer `error.details.risk` à l'utilisateur ; n'activer qu'avec son accord explicite |
| `fx_mode_unavailable`, `fx_channel_unavailable` | Mode `converted` pas ouvert : proposer `local` (avec l'accord de l'utilisateur sur le risque) ou rester en `none` |
| `quote_expired` | Le client rechoisit son pays sur la page, rien à faire côté code |
| `reference_conflict` | Même référence, autres valeurs (le client a changé d'offre) : `cancelPayment` sur l'ancien essai, puis nouvel essai `retryReference(id, n + 1)`, jamais la même référence |
| `payment_in_progress` | Réessayer dans une minute, même appel. Sur `cancelPayment` : ne créez PAS de second paiement, attendez l'avis de l'issue |
| `payment_already_completed` | `cancelPayment` : le paiement est déjà payé. Relire le paiement ; ne créer aucun nouvel essai |
| `payment_not_found`, `refund_not_found` | Mauvais identifiant ou autre compte |
| `payment_expired` | Cette référence est un essai expiré : nouveau paiement avec une NOUVELLE référence, jamais le même appel |
| `payment_not_refundable` | Seul un paiement `completed` se rembourse |
| `refund_exceeds_payment` | Rembourser au plus `error.details.refundableAmount` |
| `refund_conflict` | Cette `reference` de remboursement a déjà servi avec d'autres valeurs |
| `insufficient_balance` | Recharger au moins `error.details.missingAmount` avec `topUpBalance`, puis rappeler |
| `payer_unknown`, `refund_network_unavailable` | Remboursement impossible par Technas : rembourser le client autrement, prévenir Technas |
| `provider_unavailable`, `unavailable`, `network_error` | Panne passagère : refaire le même appel |
| `rate_limited` | Ralentir, réessayer |

## Vérifier l'intégration

Avec un secret `tps_test_`, aucun argent ne circule.

1. Lancez l'application et déclenchez un paiement : `checkoutUrl` ouvre une page de test (choix du pays, opérateurs, boutons « réussi » ou « refusé »).
2. Cliquez sur « Simuler un paiement réussi », puis contrôlez côté serveur avec `pay.getPaymentByReference(reference)`.
   Testez aussi la relance : sur un autre paiement, « Simuler un refus » (rien ne doit être relancé), puis « Simuler l'expiration du lien » (`onExpired` doit relancer avec une nouvelle référence). Sans navigateur : `pay.simulateTestPayment(id, "failed")` puis `"expired"`. Un paiement de test non payé expire aussi tout seul au bout d'une heure.
3. Remboursez avec `pay.refund(payment.id)` : en test, le remboursement est terminé aussitôt, avec des frais réalistes, et aucun argent ne part. Si le solde manque, `pay.topUpBalance` ouvre une page de test pour le recharger.
4. Le webhook n'arrive sur votre poste que si Technas connaît une adresse publique. Sinon, testez la route avec `pay.createTestWebhook`, et demandez à l'utilisateur de transmettre à son contact Technas l'adresse d'un tunnel.

## Passer en réel

Remplacez seulement le secret par `tps_live_…`. `returnUrl` doit alors être en https. Cette étape revient à l'utilisateur et à Technas : ne la faites pas de votre propre initiative.
