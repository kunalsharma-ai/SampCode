# Billing (Milestone 13)

Billing is optional and **off by default**: plans are then set by an operator with
`node apps/api/dist/cli/set-plan.js` ([plans](sso-scim-plans.md#plans-and-limits)). With
Settings → Integrations → Stripe, an organization's admins buy and manage their plan themselves and Stripe tells
SampCode what they pay for. SampCode never sees card details.

Status: tested against a fake Stripe API with real webhook signatures (`apps/api/test/m13.test.ts`),
**not yet with a Stripe account**. Before charging anyone, run one purchase, one upgrade and one
cancellation in Stripe's test mode.

## Set up

1. In Stripe, create a product per plan you sell and a recurring price for each. Plans and their
   limits stay in SampCode's code (`apps/api/src/plans/plans.ts`); Stripe only holds the price.
2. Add a webhook endpoint `${STUDIO_URL}/api/billing/webhook` with the events
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`
   and `customer.subscription.deleted`. Copy its signing secret.
3. Turn on the customer portal (Billing → Customer portal) and allow plan changes between your
   prices if customers may switch plans themselves.
4. Configure SampCode in **Settings → Integrations → Stripe** (stored encrypted in the database, ADR 0043):

| Field                         | Value                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Secret key                    | A restricted key with write access to Checkout Sessions, Customer portal and read access to Subscriptions |
| Webhook signing secret        | The endpoint's signing secret (`whsec_...`)                                                               |
| Plan prices                   | `{"team":"price_...","business":"price_..."}`                                                             |
| Stripe API version            | Optional: pin the API version                                                                             |
| Plan when a subscription ends | `free` unless chosen                                                                                      |

Stripe cannot be turned on until the key, the webhook secret and the prices are filled in.

## How it works

- **Buy:** Settings → Billing lists the plans that have a price. Choosing one opens Stripe
  Checkout for a subscription, tied to the organization (`client_reference_id` and subscription
  metadata). The plan does not change when the admin returns; it changes when Stripe confirms.
- **Webhooks** are checked against the webhook signing secret (HMAC-SHA256 over the raw body, 5 minute
  tolerance) and applied once (`BillingEvent`). For every subscription event SampCode reads the
  subscription back from Stripe, so late or out-of-order events cannot set an old state.
- **Statuses:** `active` and `trialing` give the paid plan. `past_due` keeps it while Stripe retries
  the payment (the panel asks the admin to update the payment method). `canceled`, `unpaid`,
  `incomplete_expired` and a deleted subscription move the organization to
  `BILLING_FALLBACK_PLAN`. Limits then work as always: nothing already collected is lost, and
  people in an interview can finish.
- **Manage:** "Manage billing" opens the Stripe customer portal (payment method, invoices, plan
  change, cancellation).
- **Audit:** `billing.checkout` when an admin starts a checkout, `billing.plan_sync` for every plan
  or status change from Stripe.
- One Stripe customer pays for one organization. A checkout that names a customer already linked to
  another organization is not applied and is logged as an error for a person to look at.

## Limits

- One subscription with one price per organization; no seat-based quantities, usage-based billing,
  coupons in SampCode, or invoices shown inside SampCode (they are in the Stripe portal).
- Taxes, currencies and invoicing rules are configured in Stripe, not SampCode.
