/** @type {import('next').NextConfig} */
const path = require("path");
const backendOrigin = process.env.API_INTERNAL_URL || "http://127.0.0.1:8000";

const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Opt this app into security-driven Next.js upgrade guidance so the CLI
    // keeps recommending patched releases for published security advisories.
    agentUpgrade: "security",
    // Turbopack keeps a persistent dev cache under `.next/dev`. If the dev
    // server is killed mid-write (OOM kill, terminal closed, `.next` removed
    // while it runs) that cache can be left half-written: PostCSS then emits
    // corrupted CSS and the App Router serves `404 - This page could not be
    // found` for routes that actually exist (e.g. /reports/activations) until
    // `.next` is deleted by hand. Keeping the dev cache in memory makes every
    // `next dev` start deterministic — a crashed run can never poison the next.
    // Production builds are unaffected (`turbopackFileSystemCacheForBuild`
    // stays at its own default).
    turbopackFileSystemCacheForDev: false,
  },
  allowedDevOrigins: ["165.99.219.177"],
  devIndicators: { position: "bottom-right" },
  // Commission was promoted from a `commercial/commission` sub-page to its own
  // top-level module at `/commission`. Keep old links and bookmarks working.
  async redirects() {
    return [
      { source: "/commercial/commission", destination: "/commission", permanent: true },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backendOrigin}/api/:path*` },
      { source: "/uploads/:path*", destination: `${backendOrigin}/uploads/:path*` },
    ];
  },
};

module.exports = nextConfig;