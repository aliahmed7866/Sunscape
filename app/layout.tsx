import "./globals.css";

export const metadata = {
  title: "Sunscape",
  description: "Sunrise and sunset quality predictions using free weather data.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
