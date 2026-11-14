// @technas/pay-next : le cœur @technas/pay, réglé pour Next.js.
//
// Tout le SDK (paiements, remboursements, change, webhooks, erreurs, types) vit dans
// @technas/pay, partagé avec Express, Fastify, NestJS… Ce paquet n'ajoute que ce que Next
// demande : aucune mise en cache des appels (`cache: "no-store"`, Next met `fetch` en cache
// par défaut) et un refus net s'il est importé dans un composant client.

import { createTechnasPay as createCore, type TechnasPayOptions } from "@technas/pay";

export * from "@technas/pay";

/** Comme `createTechnasPay` de `@technas/pay`, avec les appels jamais mis en cache par Next. */
export function createTechnasPay(options: TechnasPayOptions) {
  return createCore({ ...options, requestInit: { cache: "no-store", ...options.requestInit } });
}

export type TechnasPay = ReturnType<typeof createTechnasPay>;
