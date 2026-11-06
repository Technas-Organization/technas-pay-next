export const metadata = { title: "Boutique d'exemple" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "0 auto", padding: 16 }}>{children}</body>
    </html>
  );
}
