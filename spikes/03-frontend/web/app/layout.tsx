// PROTOTYPE — spike 03. Throwaway.
import 'uplot/dist/uPlot.min.css';

const errTrap = `window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message||e.type)+' @ '+(e.filename||(e.target&&(e.target.src||e.target.href))||''))},true);window.addEventListener('unhandledrejection',function(e){window.__errs.push('rejection: '+String(e.reason))});`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: errTrap }} />
      </head>
      <body style={{ fontFamily: 'system-ui', margin: 16 }}>{children}</body>
    </html>
  );
}
