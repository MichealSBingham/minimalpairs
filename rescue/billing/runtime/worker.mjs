import { createBillingHandler } from '../core.mjs';
import { createFirebaseAdapter, createSandboxFirebaseAdapter } from '../providers/firebase.mjs';
import { createStripeAdapter } from '../providers/stripe.mjs';
import { BillingLedgerBase } from './ledger.mjs';
import { billingConfig, unavailable } from './config.mjs';
import { billingLedgerName, wakeBillingLedger } from './scheduled.mjs';
import {purchaseFeed} from './purchase-feed.mjs';

export class BillingLedger extends BillingLedgerBase {
  createExternalPorts() {
    const firebase = this.config.expectedLivemode ? createFirebaseAdapter : createSandboxFirebaseAdapter;
    return {
      ...firebase(this.env, { expectedLivemode: this.config.expectedLivemode,
        getOperationContext: () => this.getOperationContext() }),
      stripe: createStripeAdapter({ secretKey: this.env.STRIPE_SECRET_KEY, expectedAccountId: this.env.STRIPE_ACCOUNT_ID,
        expectedLivemode: this.config.expectedLivemode, prices: this.config.prices, recoveryCouponId:this.config.recoveryCouponId,
        getOperationContext: () => this.getOperationContext() }),
    };
  }
}

export default {
  async fetch(request, env) {
    if(new URL(request.url).pathname==='/internal/buyer-events')return purchaseFeed(request,env);
    try {
      const config = billingConfig(env);
      if (!config.serviceEnabled) return createBillingHandler(config, {})(request);
      const name = billingLedgerName(config);
      return await env.BILLING_LEDGER.getByName(name).fetch(request);
    } catch (error) { return unavailable(error); }
  },
  scheduled: wakeBillingLedger,
};
