import { billingConfig } from './config.mjs';

export const billingLedgerName = config => config.expectedLivemode ? 'billing-v1-live' : 'billing-v1-test';

/** Hourly infrastructure recovery only. Disabled invocations stop before config
 * parsing, namespace access or any storage/provider I/O. The private RPC merely
 * restores the normal alarm from existing due state; it processes no customer. */
export async function wakeBillingLedger(_controller, env) {
  if (env.BILLING_SERVICE_ENABLED !== 'true') return;
  const config = billingConfig(env);
  await env.BILLING_LEDGER.getByName(billingLedgerName(config)).rearmFromDurableState();
}
