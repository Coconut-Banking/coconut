/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Permissions-Policy",
            value: "accelerometer=*, encrypted-media=*",
          },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
