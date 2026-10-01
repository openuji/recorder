import type { APIRoute } from "astro";

export const prerender = true;

const routes = [
  "/",
  "/fu-pilot/",
  "/fu-pilot/privacy/",
  "/fu-pilot/participate/",
];

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://recorder.openuji.org");
  const urls = routes
    .map((route) => `  <url><loc>${new URL(route, base).toString()}</loc></url>`)
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
