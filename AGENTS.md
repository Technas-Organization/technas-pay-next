# @technas/pay-next : règles pour un agent de code

Consignes pour un assistant de code (Codex, Claude Code…). Appliquez-les dans l'application de l'utilisateur, pas dans ce dépôt. Le README détaille chaque fonction. Un exemple complet se trouve dans [`example/`](example).

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
| Rembourser un client | `pay.refund(paymentId, { amount?, fees?, reference? })` |
| Noter un remboursement fait hors Technas (Flooz, T-Money, espèces) | `pay.recordExternalRefund(paymentId, { amount, method, note?, recordedBy? })` |
| Savoir que le remboursement est arrivé | webhook `onRefund` (`refund.completed`, `refund.failed` ou `refund.recorded`) |
| Recharger le solde pour rembourser | `pay.topUpBalance({ amount, currency })`, puis ouvrir `checkoutUrl` ; webhook `onTopUp` |
| Afficher le solde | `pay.getBalance()` |
| Afficher l'historique | `pay.listTransactions({ limit, status, cursor })` |
| Reversements, numéro de reversement | `pay.getSettlements()`, `pay.getPayoutDestination()`, `pay.setPayoutDestination(...)` |
| Tester la route webhook | `pay.createTestWebhook(type, paiement)` |

## Étapes

1. `npm install github:Technas-Organization/technas-pay-next#v0.6.0`
2. Créez `lib/pay.ts` :
   ```ts
   import { createTechnasPay } from "@technas/pay-next";

   export const pay = createTechnasPay({ secret: process.env.TECHNAS_PAY_SECRET! });
   ```
3. Dans une Server Action, relisez la commande en base, appelez `pay.askForPayment(...)`, gardez `payment.id` sur la commande, puis `redirect(checkoutUrl)`.
4. Créez `app/api/technas-pay/route.ts` :
   ```ts
   export const POST = pay.webhookHandler({ onCompleted, onFailed, onRefund, onTopUp });
   ```
   Dans `onCompleted`, marquez la commande payée à partir de `event.payment.reference`.
5. Ajoutez un test avec `pay.createTestWebhook`, puis lancez-le.

## Obligatoire

- **`amount`** : un entier en unité principale (`5000` = 5 000 FCFA, jamais × 100), calculé côté serveur.
- **`reference`** : l'identifiant unique de la commande.
- **`customer.email`** et **`customer.name`** : de vrais champs du client, jamais inventés.
- **`returnUrl`** : la page de retour, en https en production.
- Le reste est facultatif. Passez `customer.country` et `customer.phone` si l'application les connaît : ils évitent au client de choisir son pays.

## La devise est automatique

- **Ne passez pas `currency`** si l'application vend en francs CFA.
  - La devise suit le pays du client : TG → XOF, CM → XAF, pour le même montant.
  - Sans pays, le client choisit le sien sur la page de paiement.
- **Ne fixez pas `defaultCurrency`** : il empêcherait ce choix.
- **Hors zone franc CFA** (Ghana, Nigeria…), demandez la devise à l'utilisateur et passez `currency`.
- **La devise payée fait foi** : lisez `event.payment.currency` dans le webhook. Un même montant peut arriver en XOF ou en XAF.

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

## Webhooks

- **Ils peuvent arriver plusieurs fois** : vos fonctions doivent le supporter. Vérifiez l'état en base, ou gardez `event.id`.
- **Ne rattrapez pas leurs erreurs pour répondre 200.** Une erreur doit remonter pour que le webhook soit relivré.
- **`onFailed` n'est pas définitif** : `onCompleted` peut arriver après.
- **`onRefund`** : prévenez le client, par e-mail ou SMS. Technas ne lui écrit pas.
  - `refund.completed` : l'argent est arrivé, `sentAmount` sur son téléphone.
  - `refund.failed` : rien n'est parti et votre solde est recrédité. Proposez un autre moyen, ou refaites le même appel `refund` : il est permis après un échec.

## Rembourser

- **Appel** : `pay.refund(paymentId)` rembourse tout ce qui reste ; `pay.refund(paymentId, { amount })` rembourse une partie.
- **Destination** : l'argent repart au numéro qui a payé, jamais à un autre.
- **Plafond** : le total remboursé ne dépasse jamais le montant payé.
- **Commission** : les 2 % ne sont pas rendus.
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

## Erreurs

`error.code`, avec `error.retryable` (vrai : refaites **le même appel**, mêmes valeurs) et `error.details`.

| `error.code` | Que faire |
|---|---|
| `invalid_secret` | Variable absente ou mal copiée : demandez à l'utilisateur de la vérifier |
| `invalid_api_key` | Secret refusé : contacter Technas |
| `invalid_request` | Corriger le champ indiqué dans `error.errors` |
| `invalid_amount`, `amount_too_low` | Montant entier positif, assez grand pour couvrir les frais |
| `currency_not_enabled` | Devise non ouverte sur ce compte : contacter Technas |
| `currency_conversion_unavailable` | Pays hors zone franc CFA sans `currency` : demander la devise à l'utilisateur |
| `reference_conflict` | Même référence, autres valeurs : ne pas réutiliser la référence |
| `payment_in_progress` | Réessayer dans une minute, même appel |
| `payment_not_found`, `refund_not_found` | Mauvais identifiant ou autre compte |
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
3. Remboursez avec `pay.refund(payment.id)` : en test, le remboursement est terminé aussitôt, avec des frais réalistes, et aucun argent ne part. Si le solde manque, `pay.topUpBalance` ouvre une page de test pour le recharger.
4. Le webhook n'arrive sur votre poste que si Technas connaît une adresse publique. Sinon, testez la route avec `pay.createTestWebhook`, et demandez à l'utilisateur de transmettre à son contact Technas l'adresse d'un tunnel.

## Passer en réel

Remplacez seulement le secret par `tps_live_…`. `returnUrl` doit alors être en https. Cette étape revient à l'utilisateur et à Technas : ne la faites pas de votre propre initiative.
