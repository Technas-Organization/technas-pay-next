# @technas/pay-next

Encaissez des paiements via Technas depuis une application Next.js 13.4 ou plus récente.

Vous intégrez avec un assistant de code (Codex, Claude Code…) ? Dites-lui de lire [AGENTS.md](AGENTS.md).

## 1. Installer

```bash
npm install github:Technas-Organization/technas-pay-next#v0.1.0
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
| `pay.getBalance()` | Ce que Technas vous doit, par devise |
| `pay.getSettlements()` | Vos reversements |
| `pay.verifyWebhook(corpsBrut, signature)` | Vérifier un webhook hors App Router |
| `pay.createTestWebhook(type, paiement)` | Fabriquer un webhook signé pour vos tests (secret `tps_test_` seulement) |

## Obtenir un secret

Demandez-le à votre contact Technas : un secret de test pour intégrer, puis un secret réel avec vos conditions commerciales et votre numéro de reversement. Pour recevoir les webhooks en test, donnez-lui une adresse joignable depuis internet, par exemple un tunnel vers votre poste.

## Licence

[MIT](LICENSE). Le package est libre ; l'accès au service de paiement dépend de votre contrat avec Technas.
