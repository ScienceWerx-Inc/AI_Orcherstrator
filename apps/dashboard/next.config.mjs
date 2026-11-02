/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output is only needed for container images; local `next start`
  // works with the regular build output.
  ...(process.env.NEXT_STANDALONE === "true" ? { output: "standalone" } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
