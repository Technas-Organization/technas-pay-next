# Intégrer @technas/pay-next dans une application Next.js

Consignes pour un assistant de code (Codex, Claude Code…). Suivez-les dans l'application de l'utilisateur, pas dans ce dépôt. Le code complet d'un exemple est dans [`example/`](example).

## Avant de commencer

1. Vérifiez que l'application utilise Next.js 13.4+ avec App Router. Sinon, utilisez `pay.verifyWebhook` (voir le README).
2. Vérifiez que `TECHNAS_PAY_SECRET` existe dans l'environnement ou `.env.local`, et qu'il commence par `tps_test_`. S'il manque, demandez-le à l'utilisateur. **N'en inventez pas, ne l'affichez pas, ne le commitez pas.** Vérifiez que `.env.local` est ignoré par git.
3. Repérez le modèle de commande existant : il faut une référence unique, un montant calculé côté serveur et un état « payée ».

## Étapes

1. `npm install github:Technas-Organization/technas-pay-next#v0.2.0`
2. Créez `lib/pay.ts` :
   ```ts
   import { createTechnasPay } from "@technas/pay-next";

   export const pay = createTechnasPay({ secret: process.env.TECHNAS_PAY_SECRET! });
   ```
3. Dans une Server Action, relisez la commande en base, appelez `pay.askForPayment({ amount, currency, reference, customer: { email, name }, returnUrl })`, puis `redirect(checkoutUrl)`.
4. Créez `app/api/technas-pay/route.ts` et exportez `POST = pay.webhookHandler({ onCompleted, onFailed })`. Marquez la commande payée dans `onCompleted`, à partir de `event.payment.reference`.
5. Ajoutez un test avec `pay.createTestWebhook`, puis lancez-le.

## Règles à ne pas enfreindre

- **Côté serveur uniquement.** N'importez jamais `lib/pay.ts` dans un fichier `"use client"`. Pas de préfixe `NEXT_PUBLIC_` sur le secret.
- **Seul le webhook prouve le paiement.** Ne marquez jamais une commande payée depuis la page `returnUrl`.
- **Montant côté serveur.** Ne le lisez pas dans un formulaire ou une requête du navigateur.
- **Montants entiers, en unité principale** : `5000` = 5 000 FCFA, jamais × 100.
- **`onCompleted` doit supporter d'être appelée plusieurs fois.** Le webhook est relivré tant que la réponse n'est pas 2xx. Vérifiez l'état de la commande ou gardez `event.id`.
- **`onFailed` n'est pas définitif** : `onCompleted` peut arriver après.
- **Ne rattrapez pas les erreurs de `onCompleted`** pour répondre 200 : une erreur doit remonter pour que le webhook soit relivré.
- **Une référence = un paiement.** Réutilisez celle de la commande pour une reprise. Si `error.retryable` est vrai, refaites le même appel avec la même référence.
- **Conservez le corps brut** : `webhookHandler` le lit lui-même. Ne le passez pas par `request.json()` avant.

## Afficher le compte

- `pay.getBalance()` : le solde, par devise, déjà net de la commission Technas.
- `pay.listTransactions({ limit, status, cursor })` : l'historique, du plus récent au plus ancien. Passez `nextCursor` pour la page suivante. `status` : `pending`, `completed`, `failed`, `amount_mismatch`.

Appelez-les côté serveur uniquement. Il n'y a pas de retrait par API : les reversements se règlent avec Technas.

## Vérifier l'intégration

Avec un secret `tps_test_`, aucun argent ne circule.

1. Lancez l'application et déclenchez un paiement : `checkoutUrl` ouvre une page de test.
2. Cliquez sur « Simuler un paiement réussi » : le client revient sur `returnUrl`.
3. Contrôlez côté serveur avec `pay.getPaymentByReference(reference)` : `status` vaut `completed`, et `pay.getBalance()` a augmenté de `netAmount`.
4. Le webhook n'arrive sur votre poste que si Technas connaît une adresse publique. Sinon, testez la route avec `pay.createTestWebhook`, et demandez à l'utilisateur de transmettre à son contact Technas l'adresse d'un tunnel pour l'essai complet.

## Erreurs

| `error.code` | Sens | Que faire |
|---|---|---|
| `invalid_secret` | Variable absente ou mal copiée | Demander à l'utilisateur de la vérifier |
| `invalid_api_key` | Secret refusé | Contacter Technas |
| `currency_not_enabled` | Devise non ouverte sur ce compte | Contacter Technas |
| `amount_too_low` | Le montant ne couvre pas les frais | Augmenter le montant |
| `reference_conflict` | Même référence, autre montant | Corriger, ne pas réutiliser la référence |
| `payment_in_progress` | Création en cours | Réessayer dans une minute |
| `provider_unavailable`, `unavailable`, `network_error` | Panne passagère | Réessayer avec la même référence |
| `invalid_request` | Champ invalide, détail dans `error.errors` | Corriger la demande |

## Passer en réel

Remplacez seulement le secret par `tps_live_…`. `returnUrl` doit alors être en https. Cette étape revient à l'utilisateur et à Technas : ne la faites pas de votre propre initiative.
