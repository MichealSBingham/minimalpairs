import { BillingError } from '../core.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function billingConfig(env) {
  let data = {}, secrets = [], supportOffers = {};
  try {
    if (env.SUPPORT_OFFERS_JSON) supportOffers = JSON.parse(env.SUPPORT_OFFERS_JSON);
    if (env.BILLING_CONFIG_JSON) data = JSON.parse(env.BILLING_CONFIG_JSON);
    if (env.STRIPE_WEBHOOK_SECRETS_JSON) secrets = JSON.parse(env.STRIPE_WEBHOOK_SECRETS_JSON);
  } catch { throw new BillingError('billing_config_invalid', 503); }
  if (!object(data) || !Array.isArray(secrets)) throw new BillingError('billing_config_invalid', 503);
  return {
    ...data,
    supportOffers,
    // JSON config cannot turn the service on. These server bindings are separate.
    serviceEnabled: env.BILLING_SERVICE_ENABLED === 'true',
    checkoutEnabled: env.BILLING_CHECKOUT_ENABLED === 'true',
    communicationsApproved: env.BILLING_COMMUNICATIONS_APPROVED === 'true',
    expectedLivemode: data.expectedLivemode === true,
    appOrigin: typeof data.appOrigin === 'string' ? data.appOrigin : 'https://minimalpairs.co',
    webhookSecrets: secrets,
  };
}

export function unavailable(error) {
  return new Response(JSON.stringify({ error: error instanceof BillingError ? error.code : 'billing_temporarily_unavailable' }), {
    status: error instanceof BillingError ? error.status : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
