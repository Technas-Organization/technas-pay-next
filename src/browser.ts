// Résolu à la place du package quand il est importé dans du code navigateur.
// Le secret ne doit jamais y arriver : on casse tout de suite et clairement.
throw new Error(
  "@technas/pay-next s'utilise côté serveur uniquement (Server Action, Route Handler). " +
    "Ne l'importez pas dans un composant client : votre secret y serait exposé.",
);
export {};
