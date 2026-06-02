/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Proxy /api/* to the Rust backend server-side so the browser only ever
  // talks to the Next.js origin (no CORS, no Private Network Access block).
  // Override the backend target with BACKEND_URL if it's not on localhost:8081.
  async rewrites() {
    const backend = process.env.BACKEND_URL || "http://localhost:8081";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
