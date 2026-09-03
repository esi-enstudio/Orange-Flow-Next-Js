/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  allowedDevOrigins: ["165.99.219.177"],
  devIndicators: true,
};

module.exports = nextConfig;