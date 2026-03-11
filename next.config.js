/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Permissions-Policy",
            value: "accelerometer=(self \"https://*.clerk.accounts.dev\" \"https://*.clerk.dev\" \"https://js.stripe.com\"), encrypted-media=(self \"https://*.clerk.accounts.dev\" \"https://*.clerk.dev\" \"https://js.stripe.com\")",
          },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
