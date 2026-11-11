# @technas/pay-next

Encaissez des paiements via Technas depuis une application Next.js 13.4 ou plus récente.

Vous intégrez avec un assistant de code (Codex, Claude Code…) ? Dites-lui de lire [AGENTS.md](AGENTS.md).

## 1. Installer

```bash
npm install github:Technas-Organization/technas-pay-next#v0.4.0
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
    amount: 5000, // entier : 5 000 FCFA
    currency: "XOF",
    reference: commandeId,
    customer: { email: "client@exemple.com", name: "Awa Mensah" },
    returnUrl: "https://votre-site.com/merci",
  });
  redirect(checkoutUrl);
}
```

Calculez le montant côté serveur, jamais à partir d'une valeur envoyée par le navigateur.

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
