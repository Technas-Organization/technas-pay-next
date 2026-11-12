# @technas/pay-next

Encaissez des paiements via Technas depuis une application Next.js 13.4 ou plus récente.

Vous intégrez avec un assistant de code (Codex, Claude Code…) ? Dites-lui de lire [AGENTS.md](AGENTS.md), livré dans le paquet avec [llms.txt](llms.txt) (`node_modules/@technas/pay-next/AGENTS.md`).

## 1. Installer

```bash
npm install github:Technas-Organization/technas-pay-next#v0.6.0
```

Le package se compile à l'installation et s'importe sous le nom `@technas/pay-next`.

Technas vous remet **un secret**. Mettez-le dans vos variables d'environnement serveur, sans préfixe `NEXT_PUBLIC_` :

```bash
TECHNAS_PAY_SECRET=tps_test_...
```

Un secret `tps_test_` ne déplace aucun argent : la page de paiement propose simplement « réussi » ou « refusé ». Un secret `tps_live_` encaisse pour de vrai. Le code est le même.

## 2. Demander un paiement

```ts
// lib/pay.ts
import { createTechnasPay } from "@technas/pay-next";

export const pay = createTechnasPay({ secret: process.env.TECHNAS_PAY_SECRET! });
```

```ts
// app/commande/actions.ts
"use server";
import { redirect } from "next/navigation";
import { pay } from "@/lib/pay";

export async function payerCommande(commandeId: string) {
  const { checkoutUrl } = await pay.askForPayment({
    amount: 5000, // entier : 5 000 FCFA, et c'est tout pour l'argent
    reference: commandeId,
    customer: { email: "client@exemple.com", name: "Awa Mensah" },
    returnUrl: "https://votre-site.com/merci",
  });
  redirect(checkoutUrl);
}
```

Calculez le montant côté serveur, jamais à partir d'une valeur envoyée par le navigateur.

### La devise

Donnez seulement le montant, en francs CFA : chaque client paie dans la monnaie de son pays. Le XOF (Afrique de l'Ouest) et le XAF (Afrique centrale) sont à parité fixe, donc **le montant ne change pas**.

La devise se choisit dans cet ordre :

1. `currency`, si vous la passez à l'appel ;
2. sinon celle du pays du client, `customer.country` (code ISO à deux lettres) ;
3. sinon `defaultCurrency`, passé à `createTechnasPay` ;
4. sinon **le client choisit son pays** sur la page de paiement, qui lui propose ensuite les opérateurs de ce pays. Son numéro (`customer.phone`, format international) préremplit ce choix.

| Pays | Devise |
|---|---|
| Bénin `BJ`, Burkina Faso `BF`, Côte d'Ivoire `CI`, Mali `ML`, Niger `NE`, Sénégal `SN`, Togo `TG` | `XOF` |
| Cameroun `CM`, Congo `CG`, Gabon `GA` | `XAF` |
| Guinée-Bissau `GW`, Centrafrique `CF`, Guinée équatoriale `GQ`, Tchad `TD` | Pas encore d'opérateur ouvert : affichés « bientôt » |

- **Votre solde et le webhook suivent la devise réellement payée.** Un client camerounais crédite votre solde en XAF, et `event.payment.currency` vaut `"XAF"`. Il vous faut un numéro de reversement par devise (voir plus bas).
- Tant que le client n'a pas choisi son pays, `payment.currency` vaut `null`.
- **Hors zone franc CFA** (Ghana, Nigeria, Kenya…) : voir la section suivante.
- `currencyForCountry("CM")` rend `"XAF"`, pour afficher le prix avec la bonne devise.

### Clients hors zone franc CFA

Vous donnez toujours le montant en francs CFA. Ce qui se passe pour un client du Ghana, du Nigeria ou du Kenya dépend de votre **mode de change**. C'est Technas qui le règle avec vous ; `pay.getFxMode()` le lit.

| Mode | Ce que paie le client | Ce que vous recevez |
|---|---|---|
| `none` (au départ) | Il ne peut pas payer : seuls les pays de la zone CFA sont proposés | — |
| `local` | Votre montant converti au cours du jour, dans sa monnaie | Un solde dans sa monnaie (cedis…), reversé sur **votre numéro de reversement dans cette monnaie** |
| `converted` | Votre montant au cours du jour, plus des frais de change | Des francs CFA. Pas encore disponible |

- **Ce que voit le client** : avant de payer, la page lui montre le montant exact dans sa monnaie, le cours, les frais de change éventuels et la source du cours. Ce montant est garanti 30 minutes.
- **Pays ouverts** : un pays n'apparaît que si tout est prêt. En mode `local`, il faut un numéro de reversement **confirmé** dans la monnaie de ce pays (`setPayoutDestination`), sinon votre argent n'aurait nulle part où aller. `pay.getFxMode()` liste les pays et dit ce qui manque à chacun (`reason`).
- **Dans le webhook** :
  - `event.payment.amount` et `event.payment.currency` : ce que le client a payé (par exemple `121.96` `GHS`) ;
  - `event.payment.originalAmount` : votre montant en francs CFA ;
  - `event.payment.fx` : le cours, les frais et la devise de votre solde.
- **Montants à centimes** : hors zone, un montant peut avoir des centimes (cedis…). Ne l'arrondissez pas.
- **Sans mode de change**, un client hors zone avec `customer.country` reçoit l'erreur `currency_conversion_unavailable`. Avec `currency: "GHS"`, le montant est lu en cedis et non en francs CFA.

## 3. Recevoir la confirmation

Donnez à Technas l'adresse de cette route :

```ts
// app/api/technas-pay/route.ts
import { pay } from "@/lib/pay";

export const POST = pay.webhookHandler({
  onCompleted: async (event) => {
    await marquerPayee(event.payment.reference); // doit supporter d'être appelée deux fois
  },
  onFailed: async (event) => {
    await signalerEchec(event.payment.reference);
  },
});
```

## 4. Rembourser

L'argent repart **au numéro qui a payé**, par mobile money. C'est **vous qui prévenez votre client** : Technas ne lui écrit pas.

```ts
const remboursement = await pay.refund(paymentId);                        // tout ce qui reste
const partiel = await pay.refund(paymentId, { amount: 2000 });           // une partie
const net = await pay.refund(paymentId, { amount: 2000, fees: "customer" }); // frais retirés au client
```

### Règles

- **Paiement concerné** : seul un paiement `completed` de votre compte se rembourse.
- **Plafond** : le total remboursé ne dépasse jamais le montant payé. Sans `amount`, vous remboursez tout ce qui reste.
- **Commission** : la commission Technas (2 %) n'est pas rendue.
- **Frais du renvoi**, choisis par `fees` à chaque appel :

  | `fees` | Le client reçoit (`sentAmount`) | Votre solde perd (`balanceDebit`) |
  |---|---|---|
  | `"partner"` (défaut) | `amount` | `amount` + frais |
  | `"customer"` | `amount` − frais | `amount` |

- **Débit du solde** : votre solde est débité tout de suite. Si le renvoi échoue (`refund.failed`), il est recrédité.
- **Idempotence** : rejouer le même appel ne rembourse pas deux fois. Pour deux remboursements partiels identiques et voulus, donnez à chacun une `reference`, par exemple l'identifiant de votre décision.
- **Solde insuffisant** : l'appel échoue avec `insufficient_balance`, sans rien envoyer. `error.details.missingAmount` dit combien il manque. Rechargez avec `pay.topUpBalance({ amount, currency })` : c'est un paiement mobile money sans commission, confirmé par le webhook `balance.topped_up`. Ensuite, rappelez `refund`.

### Remboursement fait hors Technas

Vous avez rendu l'argent vous-même, par Flooz, T-Money ou en espèces ? Enregistrez-le :

```ts
await pay.recordExternalRefund(paymentId, {
  amount: 2000,
  method: "Flooz",                  // obligatoire : "T-Money", "Espèces", "Virement"…
  note: "Article abîmé, geste du SAV", // facultatif
  recordedBy: "jacques@blexima.tg",    // facultatif : qui l'a fait
});
```

- **Aucun mouvement** : aucun argent ne part, votre solde ne change pas.
- **Plafond commun** : il compte dans le plafond. Avec les remboursements de `refund`, le total ne dépasse jamais le montant payé.
- **Idempotence** : rejouer le même appel n'enregistre pas deux fois. Pour deux enregistrements identiques, donnez à chacun une `reference`.
- **Webhook** : `refund.recorded`, reçu dans `onRefund`.
- **Sur le paiement** : `payment.refundedAmount` additionne tout ce qui a été remboursé, par Technas ou hors Technas.

### Exemple de back-office

La décision → `pay.refund` → le résultat immédiat ou le webhook → le message au client.

```ts
// app/admin/remboursements/actions.ts — réservé aux administrateurs
"use server";
import { TechnasPayError } from "@technas/pay-next";
import { pay } from "@/lib/pay";

export async function rembourser(decisionId: string) {
  const decision = await db.decision.findUniqueOrThrow({ where: { id: decisionId }, include: { commande: true } });
  try {
    const r = await pay.refund(decision.commande.technasPaymentId, {
      amount: decision.montant,  // absent : tout ce qui reste
      fees: decision.fraisAuClient ? "customer" : "partner",
      reference: decision.id,    // rejouer cette décision ne rembourse pas deux fois
    });
    await db.decision.update({ where: { id: decisionId }, data: { refundId: r.id, statut: r.status } });
    if (r.status === "completed") await prevenirClient(decision, r.sentAmount, r.currency);
    // "pending" : le résultat arrive dans onRefund, ci-dessous.
    return { ok: true, statut: r.status };
  } catch (e) {
    if (e instanceof TechnasPayError && e.code === "insufficient_balance") {
      const recharge = await pay.topUpBalance({ amount: e.details.missingAmount!, currency: e.details.currency! });
      return { ok: false, rechargerIci: recharge.checkoutUrl }; // payez, puis relancez la décision
    }
    if (e instanceof TechnasPayError && e.retryable) return { ok: false, reessayer: true };
    throw e;
  }
}
```

```ts
// app/api/technas-pay/route.ts
export const POST = pay.webhookHandler({
  onCompleted: async (event) => { /* … */ },
  onRefund: async (event) => {
    const decision = await db.decision.findUnique({ where: { refundId: event.refund.id } });
    if (!decision || decision.statut === event.refund.status) return; // doublon
    await db.decision.update({ where: { id: decision.id }, data: { statut: event.refund.status } });
    if (event.type === "refund.completed") {
      await prevenirClient(decision, event.refund.sentAmount, event.refund.currency);
    } else {
      await alerterAdministrateur(decision, event.refund.failure); // solde déjà recrédité
    }
  },
  onTopUp: async (event) => {
    await noterRecharge(event.topUp.amount, event.topUp.currency);
  },
});
```

Gardez `payment.id` (rendu par `askForPayment` et présent dans `event.payment.id`) sur votre commande : c'est lui que `refund` attend. À défaut, `pay.getPaymentByReference(reference)` le retrouve.

### Erreurs propres au remboursement

| `error.code` | Que faire |
|---|---|
| `payment_not_refundable` | Seul un paiement `completed` se rembourse |
| `refund_exceeds_payment` | Rembourser au plus `error.details.refundableAmount` |
| `refund_conflict` | Cette `reference` a déjà servi avec d'autres valeurs |
| `insufficient_balance` | Recharger `error.details.missingAmount` avec `topUpBalance`, puis rappeler |
| `payer_unknown` | Paiement encaissé avant l'arrivée des remboursements : rembourser autrement, prévenir Technas |
| `refund_network_unavailable` | Le réseau du client ne reçoit plus de versement : rembourser autrement |

En test (`tps_test_`), un remboursement est terminé aussitôt, avec des frais réalistes, et aucun argent ne part.

## À savoir

- **Seul le webhook prouve le paiement.** Un visiteur peut ouvrir `returnUrl` à la main : n'y livrez rien.
- **Un même événement peut arriver plusieurs fois.** Technas relivre tant que votre route ne répond pas 2xx, pendant environ 3 jours. `event.id` permet d'ignorer un doublon.
- **Un refus n'est pas définitif.** Le client peut réessayer sur la même page, et `onCompleted` arriver après `onFailed`.
- **Retour au site sur succès seulement.** Après un refus ou un abandon, le client reste sur la page de paiement.
- **Une référence, un paiement.** Relancer `askForPayment` avec la même référence rend le même paiement. Pour une nouvelle tentative après un abandon, utilisez une nouvelle référence, en vérifiant d'abord que l'ancienne n'a pas été payée.
- **Reprise.** Si `error.retryable` est vrai, refaites le même appel avec la même référence.

## Autres fonctions

| Fonction | Rôle |
|---|---|
| `pay.getPayment(id)` | État d'un paiement |
| `pay.getPaymentByReference(reference)` | Rattraper un webhook manqué |
| `pay.refund(paymentId, { amount?, fees?, reference? })` / `pay.getRefund(id)` | Rembourser au numéro qui a payé (voir plus haut) |
| `pay.recordExternalRefund(paymentId, { amount, method, note?, recordedBy? })` | Enregistrer un remboursement fait hors Technas |
| `pay.topUpBalance({ amount, currency })` | Recharger votre solde, sans commission |
| `pay.getFxMode()` | Votre mode de change hors zone CFA, et les pays ouverts |
| `pay.getBalance()` | Votre solde : ce que Technas vous doit, par devise, après commission |
| `pay.listTransactions({ limit, status, cursor })` | L'historique de vos paiements, par pages |
| `pay.getSettlements()` | Vos reversements : `amount` quitte votre solde, `fee` (frais mobile money, à votre charge) en est déduit |
| `pay.getPayoutNetworks(pays)` | Les réseaux mobile money qui acceptent un reversement dans ce pays |
| `pay.getPayoutDestination()` / `pay.setPayoutDestination({...})` | Votre numéro de reversement (voir ci-dessous) |
| `pay.verifyWebhook(corpsBrut, signature)` | Vérifier un webhook hors App Router |
| `pay.createTestWebhook(type, paiement)` | Fabriquer un webhook signé pour vos tests (secret `tps_test_` seulement) |

## Votre numéro de reversement

C'est vous qui le fixez, depuis votre serveur, **un par devise** :

```ts
const reseaux = await pay.getPayoutNetworks("TG"); // [{ code: "moov_tg", name: "Moov Money Togo", currency: "XOF" }, …]
await pay.setPayoutDestination({ country: "TG", network: "moov_tg", phone: "+22890000000", beneficiaryName: "Ma Société SARL" });
```

- **Rien ne change avant la confirmation** : le responsable de votre compte (adresse e-mail déclarée à Technas) reçoit un lien, valable 24 h. Une clé d'API volée ne suffit donc pas à détourner vos reversements.
- Le **premier** numéro d'une devise est actif dès le clic. Un **changement** l'est **48 h après** ; il vous est annoncé par un webhook `payout_destination.change_scheduled`, reçu par `onPayoutDestination`.
- Reposer le numéro actif annule un changement en attente. Un réseau qui n'accepte pas de reversement dans ce pays est refusé (`invalid_payout_network`).
- `pay.getPayoutDestination()` rend vos numéros par devise et leur état (`awaiting_confirmation`, `scheduled`, `active`).

Technas reverse votre solde chaque semaine dès qu'il atteint 10 000 dans la devise ; les frais du versement mobile money sont déduits de ce qui part. Tant qu'une devise n'a pas de numéro confirmé, son argent attend sur votre solde.

## Obtenir un secret

Demandez-le à votre contact Technas : un secret de test pour intégrer, puis un secret réel avec vos conditions commerciales. Pour recevoir les webhooks en test, donnez-lui une adresse joignable depuis internet, par exemple un tunnel vers votre poste.

## Licence

[MIT](LICENSE). Le package est libre ; l'accès au service de paiement dépend de votre contrat avec Technas.
