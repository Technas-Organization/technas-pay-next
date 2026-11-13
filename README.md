# @technas/pay-next

Encaissez des paiements via Technas depuis une application Next.js 13.4 ou plus récente.

Vous intégrez avec un assistant de code (Codex, Claude Code…) ? Dites-lui de lire [AGENTS.md](AGENTS.md), livré dans le paquet avec [llms.txt](llms.txt) (`node_modules/@technas/pay-next/AGENTS.md`).

## 1. Installer

```bash
npm install github:Technas-Organization/technas-pay-next#v0.8.0
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

### Choisir où vous vendez

Tout est facultatif. Sans réglage, vos clients de toute la zone franc CFA peuvent payer.

| Vous voulez… | Faites |
|---|---|
| Que le client choisisse son pays | Rien : sans `currency` ni pays, la page le lui demande |
| Fixer le pays vous-même | `customer: { country: "TG" }` |
| Vendre seulement dans certains pays, pour tout votre compte | `pay.setCountryRules({ allowed: ["TG", "BJ"] })` |
| Ne pas vendre dans certains pays | `pay.setCountryRules({ excluded: ["NG"] })` |
| Restreindre un seul paiement | `allowedCountries: [...]` ou `excludedCountries: [...]` dans `askForPayment` |
| Imposer la devise | `currency: "XAF"` : le paiement part directement dans cette devise |
| Imposer la devise et laisser choisir le pays | `currency: "XAF", askCountry: true` : la page ne propose que les pays du XAF |

Un pays refusé donne l'erreur `country_not_allowed`. Sur la page, il n'apparaît tout simplement pas.

### Clients hors zone franc CFA : une option, à vos risques

Vous donnez toujours le montant en francs CFA. Faire payer un client du Ghana, du Nigeria ou du Kenya est **une option que vous choisissez vous-même**. **Technas ne couvre aucun risque de change** et prend sa commission sur chaque paiement.

| Option | Ce que paie le client | Ce que vous recevez | Votre risque |
|---|---|---|---|
| `none` (au départ) | — : seuls les pays de la zone CFA sont proposés | — | Aucun |
| `local` | Votre montant au cours du jour, dans sa monnaie | Un solde dans sa monnaie (cedis…), reversé sur **votre numéro de reversement dans cette monnaie** | La valeur de ce solde suit le cours : si la monnaie baisse, vous perdez |
| `converted` (**pas encore ouvert**) | Votre montant au cours du jour, dans sa monnaie | Un solde dans sa monnaie, puis **changé en francs CFA** par Technas, plus tard, au cours réellement obtenu et moins le coût réel du change | Tout l'écart entre le cours du paiement et le cours du change, plus le coût du change |

```ts
const fx = await pay.getFxMode();
console.log(fx.risks.local); // le risque, en clair : lisez-le avant d'activer
await pay.setFxMode({ mode: "local", acceptRisk: true, markupPct: 2 });
```

- **Options ouvertes aujourd'hui** : `none` et `local` (`fx.availableModes`). `converted` est refusé (`fx_mode_unavailable`) tant que Technas n'a aucune filière de change : rien n'est promis qui ne soit prêt.
- **Le cours** : lu chaque jour sur ExchangeRate-API et vérifié contre une seconde source ; si elles diffèrent de plus de 2 %, la monnaie est fermée le temps de comprendre. Un cours vaut 24 h (72 h s'il a été publié un vendredi ou le week-end). Technas ne prend aucune marge de change.
- **Accepter le risque** : sans `acceptRisk: true`, l'activation est refusée (`risk_not_accepted`) et l'erreur rend le texte du risque.
- **Supplément de change** (`markupPct`, de 0 à 20 %, facultatif) : il est payé par le client, affiché avant qu'il paie, et vous revient. Il peut vous protéger d'une baisse du cours.
- **Pays ouverts** : un pays n'apparaît que si tout est prêt. Sinon, `getFxMode()` dit ce qui manque (`reason`) :
  - `no_payout_number` : en `local`, il faut un numéro de reversement **confirmé** dans la monnaie de ce pays ; en `converted`, un numéro en francs CFA. Sans lui, votre argent n'aurait nulle part où aller ;
  - `no_fresh_rate` : pas de cours frais (24 h, 72 h le week-end), ou les deux sources de cours ne concordent pas ;
  - `no_operator` : pas d'opérateur ouvert dans ce pays ;
  - `no_fx_channel` : personne ne sait encore changer cette monnaie. Le mode `converted` ne s'active pas tant qu'il n'existe aucune filière de change.
- **Ce que voit le client** : avant de payer, la page lui montre le montant exact dans sa monnaie, le cours, votre supplément et la source du cours. Le montant est garanti 30 minutes.
- **Dans le webhook** :
  - `event.payment.amount` et `event.payment.currency` : ce que le client a payé (`121.96` `GHS`) ;
  - `event.payment.originalAmount` : votre montant en francs CFA ;
  - `event.payment.fx` : le cours, le supplément et la source.
- **Mode `converted`** : chaque change vous est annoncé par `onBalanceConverted`, avec le cours réellement obtenu et le coût retiré.
- **Sécurité** : chaque changement d'option vous est annoncé par `onFxModeUpdated`. Si ce n'est pas vous, prévenez Technas.
- **Montants à centimes** : hors zone, un montant peut avoir des centimes (cedis…). Ne l'arrondissez pas.

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
    // PAS définitif : le client peut encore payer sur la même page. N'annulez rien, ne relancez rien.
    await noterTentativeRefusee(event.payment.reference);
  },
  onExpired: async (event) => {
    // Définitif : le lien est fermé, rien n'a été payé. Seul moment où relancer, avec une NOUVELLE référence.
    await relancerAvecNouvelleReference(event.payment.reference);
  },
});
```

### La règle de relance

> **Relancez avec une NOUVELLE référence seulement après `payment.expired`
> (ou `getPayment` → `expired`), jamais sur `failed`.**

| Statut | Définitif ? | Que faire |
|---|---|---|
| `pending` | Non | Attendre |
| `failed` | **Non** | Rien : le client peut réessayer sur la même page pendant une heure, et `onCompleted` arriver ensuite |
| `completed` | Oui | Livrer |
| `expired` | Oui | Relancer le client, avec une nouvelle référence |
| `amount_mismatch` | Oui | Rien n'est crédité ; contacter Technas |

- Le lien vit une heure (`payment.expiresAt`). Ensuite Technas **vérifie chez l'opérateur**
  que la page est fermée et qu'aucune transaction n'a réussi ni n'est en cours, puis passe le
  paiement en `expired` et envoie `payment.expired`. Comptez quelques minutes après `expiresAt`.
- `canRetry(payment)` vaut `true` seulement pour `expired` ; `isFinal(payment)` dit si le statut
  ne changera plus (`failed` : jamais final).
- **Une référence = un essai.** Rejouer la référence d'un paiement expiré est refusé :
  `TechnasPayError` `payment_expired` (409), qui dit de créer un nouveau paiement avec une
  NOUVELLE référence. Changez-la (par exemple `CMD-42-2`) et gardez le nouveau `payment.id`.
- `checkoutUrl` est la page Technas : elle mène à l'opérateur tant que le lien est payable et
  affiche « Lien expiré » ensuite. Un paiement `expired` a `checkoutUrl: null`.
- Un paiement `expired` ne sera jamais crédité. Si, par un cas qui ne devrait pas arriver, de
  l'argent arrivait après coup, Technas le rend au payeur et vous prévient.

```ts
import { canRetry } from "@technas/pay-next";

const p = await pay.getPaymentByReference(commande.referencePaiement);
if (canRetry(p)) {
  const nouvelle = `${commande.id}-${commande.tentatives + 1}`;
  const { checkoutUrl } = await pay.askForPayment({ ...demande, reference: nouvelle });
}
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

- **Débit du solde** : votre solde est débité tout de suite. Si le renvoi échoue (`refund.failed`), il est recrédité, et vous pouvez refaire le même appel.
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
- **Un refus n'est pas définitif.** Le client peut réessayer sur la même page, et `onCompleted` arriver après `onFailed`. Seul `expired` l'est (voir « La règle de relance »).
- **Retour au site sur succès seulement.** Après un refus ou un abandon, le client reste sur la page de paiement.
- **Une référence = un essai.** Relancer `askForPayment` avec la même référence rend le même essai (utile après une coupure). Pour une nouvelle tentative, attendez `payment.expired` (ou `canRetry`), puis utilisez une NOUVELLE référence ; l'ancienne lève `payment_expired`.
- **Reprise.** Si `error.retryable` est vrai, refaites le même appel avec la même référence.

## Autres fonctions

| Fonction | Rôle |
|---|---|
| `pay.getPayment(id)` | État d'un paiement |
| `pay.getPaymentByReference(reference)` | Rattraper un webhook manqué |
| `pay.refund(paymentId, { amount?, fees?, reference? })` / `pay.getRefund(id)` | Rembourser au numéro qui a payé (voir plus haut) |
| `pay.recordExternalRefund(paymentId, { amount, method, note?, recordedBy? })` | Enregistrer un remboursement fait hors Technas |
| `pay.topUpBalance({ amount, currency })` | Recharger votre solde, sans commission |
| `pay.getFxMode()` / `pay.setFxMode({ mode, acceptRisk, markupPct? })` | Votre option hors zone CFA, ses risques, les pays ouverts |
| `pay.setCountryRules({ allowed?, excluded? })` | Les pays où vous vendez |
| `pay.getBalance()` | Votre solde : ce que Technas vous doit, par devise, après commission |
| `pay.listTransactions({ limit, status, cursor })` | L'historique de vos paiements, par pages |
| `pay.getSettlements()` | Vos reversements : `amount` quitte votre solde, `fee` (frais mobile money, à votre charge) en est déduit |
| `pay.getPayoutNetworks(pays)` | Les réseaux mobile money qui acceptent un reversement dans ce pays |
| `pay.getPayoutDestination()` / `pay.setPayoutDestination({...})` | Votre numéro de reversement (voir ci-dessous) |
| `pay.verifyWebhook(corpsBrut, signature)` | Vérifier un webhook hors App Router |
| `pay.createTestWebhook(type, paiement)` | Fabriquer un webhook signé pour vos tests (secret `tps_test_` seulement) |
| `pay.simulateTestPayment(id, "completed" \| "failed" \| "expired")` | Mode test : jouer le payeur sans navigateur ; le vrai webhook part ensuite |
| `canRetry(paiement)` / `isFinal(paiement)` | Relance permise (`expired` seulement) / statut qui ne changera plus |

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
