/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  turbopack: {
    root: __dirname,
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
};

module.exports = nextConfig;