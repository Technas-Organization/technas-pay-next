import { noter } from "@/lib/commandes";
import { pay } from "@/lib/pay";

export const POST = pay.webhookHandler({
  onCompleted: (event) => noter(event.payment.reference, "payée", event.id),
  onFailed: (event) => noter(event.payment.reference, "refusée", event.id),
});
