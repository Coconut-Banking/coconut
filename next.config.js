/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Permissions-Policy",
            value: "accelerometer=(*), encrypted-media=(*)",
          },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
