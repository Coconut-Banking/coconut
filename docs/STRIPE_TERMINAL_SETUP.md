# Stripe Terminal & Tap to Pay Setup

## Backend (coconut web)

The following API routes support Tap to Pay on iPhone:

- `POST /api/stripe/terminal/connection-token` — Connection token for SDK
- `GET /api/stripe/terminal/location` — Terminal location (creates default if none)
- `POST /api/stripe/terminal/create-payment-intent` — PaymentIntent for in-person payments

## Webhook configuration

**Add `payment_intent.succeeded`** to your Stripe webhook in the Dashboard:

1. Stripe Dashboard → Developers → Webhooks → Your webhook
2. Click "Update details"
3. Under "Events to send", add `payment_intent.succeeded`
4. Save

The webhook records settlements when a Tap to Pay payment includes settlement metadata (`groupId`, `payerMemberId`, `receiverMemberId`).

## Apple Developer

- Tap to Pay on iPhone requires the entitlement `com.apple.developer.proximity-reader.payment.acceptance`
- Already configured in `coconut-app/app.config.js`
- Ensure your Apple Developer account has Tap to Pay approval

## Apple Pay in Checkout

Apple Pay is enabled via Stripe Dashboard payment method settings (not in code). Configure at:

- Stripe Dashboard → Settings → Payment methods → Apple Pay

## Testing

1. Deploy the coconut web app with Terminal routes and webhook handler
2. Set `EXPO_PUBLIC_API_URL` in coconut-app to your deployed URL
3. Build with `expo run:ios` (development build required for Tap to Pay)
4. Use a physical iPhone XS or later with NFC enabled
