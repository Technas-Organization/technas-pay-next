// Un fichier pour rester lisible. Dans une vraie application : votre base.
import { readFile, writeFile } from "node:fs/promises";

const FICHIER = "commandes.json";

export type Commandes = Record<string, { statut: string; evenements: string[] }>;

export async function lire(): Promise<Commandes> {
  return JSON.parse(await readFile(FICHIER, "utf8").catch(() => "{}"));
}

export async function noter(reference: string, statut: string, evenement: string) {
  const commandes = await lire();
  const commande = commandes[reference] ?? { statut, evenements: [] };
  // Un événement peut arriver deux fois : on ne le traite qu'une fois.
  if (commande.evenements.includes(evenement)) return;
  commande.evenements.push(evenement);
  commande.statut = statut;
  commandes[reference] = commande;
  await writeFile(FICHIER, JSON.stringify(commandes, null, 2));
}
