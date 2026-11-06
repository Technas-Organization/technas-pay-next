import { createTechnasPay } from "@technas/pay-next";

export const pay = createTechnasPay({
  secret: process.env.TECHNAS_PAY_SECRET!,
  baseUrl: process.env.TECHNAS_PAY_BASE_URL, // inutile en production
});
