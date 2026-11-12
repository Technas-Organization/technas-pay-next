"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { pay } from "@/lib/pay";

export async function payer() {
  const reference = `commande-${randomUUID()}`;
  const { checkoutUrl } = await pay.askForPayment({
    amount: 5000, // décidé côté serveur, jamais lu depuis le navigateur
    reference,
    // Ni devise ni pays : le client choisit son pays, XOF ou XAF suit, même montant.
    customer: { email: "awa@example.com", name: "Awa Mensah" },
    returnUrl: `${process.env.SITE_URL ?? "http://localhost:3100"}/merci`,
    description: "T-shirt Lomé",
    metadata: { panier: 42 },
  });
  redirect(checkoutUrl);
}
