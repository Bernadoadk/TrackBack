import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import tailwindStyles from "./tailwind.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: "https://cdn.shopify.com/static/fonts/inter/v4/styles.css" },
  { rel: "stylesheet", href: tailwindStyles },
];

export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const isPortal = url.pathname === "/portal";
  // When served through Shopify app proxy, assets are resolved relative to the
  // Shopify store domain instead of the Vercel app — the <base> tag fixes this.
  const appUrl = process.env.SHOPIFY_APP_URL || url.origin;
  return { isPortal, appUrl };
};

export default function App() {
  const { isPortal, appUrl } = useLoaderData<typeof loader>();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {isPortal && <base href={appUrl} />}
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        {/* No-flash: apply persisted theme before paint */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('rf_theme');if(t!=='light'&&t!=='dark')t='dark';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();",
          }}
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
