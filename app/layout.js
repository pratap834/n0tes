import './globals.css';

export const metadata = {
  title: 'Electronic Notepad • Vintage Desk Ledger',
  description: 'A classic, distraction-free sectioned notepad backed by NeonDB and deployed on Vercel.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📝</text></svg>" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
