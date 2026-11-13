import { noter } from "@/lib/commandes";
import { pay } from "@/lib/pay";

export const POST = pay.webhookHandler({
  onCompleted: (event) => noter(event.payment.reference, "payée", event.id),
  // Pas définitif : le client peut encore payer sur la même page.
  onFailed: (event) => noter(event.payment.reference, "refusée, le client peut réessayer", event.id),
  // Définitif : seul moment où relancer, avec une nouvelle référence.
  onExpired: (event) => noter(event.payment.reference, "expirée, à relancer", event.id),
});
