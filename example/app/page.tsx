import { lire } from "@/lib/commandes";
import { pay } from "@/lib/pay";
import { payer } from "./actions";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [commandes, soldes] = await Promise.all([lire(), pay.getBalance()]);
  return (
    <main>
      <h1>T-shirt Lomé</h1>
      <p>5 000 FCFA</p>
      <form action={payer}>
        <button style={{ minHeight: 44, padding: "0 16px" }}>Payer</button>
      </form>
      <h2>Ce que Technas nous doit</h2>
      <ul>{soldes.map((s) => <li key={s.currency}>{s.amount} {s.currency}</li>)}</ul>
      <h2>Commandes</h2>
      <ul>{Object.entries(commandes).map(([r, c]) => <li key={r}>{r.slice(0, 18)}… : {c.statut}</li>)}</ul>
    </main>
  );
}
