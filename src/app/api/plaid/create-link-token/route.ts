import { NextRequest, NextResponse } from "next/server";
import { plaidClient } from "@/lib/plaid";
import { getAccessToken } from "@/lib/token-store";
import { CountryCode, Products } from "plaid";

// POST /api/plaid/create-link-token
//   body: {}                       — new bank connection (Transactions)
//         { product: "investments" } — new brokerage/retirement connection
//         { item_id }              — update mode / re-auth of an existing item
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const itemId = (body as { item_id?: string })?.item_id;
    const product = (body as { product?: string })?.product;

    const base = {
      user: { client_user_id: "local-user" },
      client_name: "Budget Claude",
      country_codes: [CountryCode.Us],
      language: "en",
    };

    let linkToken: string;
    if (itemId) {
      // Update mode: re-authenticate an existing item (fixes ITEM_LOGIN_REQUIRED)
      // and refresh its history window. `products` is omitted in update mode.
      const accessToken = getAccessToken(itemId);
      const res = await plaidClient.linkTokenCreate({
        ...base,
        access_token: accessToken,
        // Pull up to ~2 years of history (default is only 90 days). Max 730.
        transactions: { days_requested: 730 },
      });
      linkToken = res.data.link_token;
    } else if (product === "investments") {
      // Brokerage and retirement institutions (Robinhood, Fidelity 401k, HSAs)
      // support the Investments product, not Transactions. Required products
      // gate which institutions Link offers, so investments connections need
      // their own token — a Transactions token would hide Robinhood entirely.
      const res = await plaidClient.linkTokenCreate({
        ...base,
        products: [Products.Investments],
      });
      linkToken = res.data.link_token;
    } else {
      const res = await plaidClient.linkTokenCreate({
        ...base,
        products: [Products.Transactions],
        // Consent to liabilities too (credit-card payment due dates). Optional
        // product → won't block depository-only institutions.
        additional_consented_products: [Products.Liabilities],
        // Pull up to ~2 years of history (default is only 90 days). Max 730.
        transactions: { days_requested: 730 },
      });
      linkToken = res.data.link_token;
    }

    return NextResponse.json({ link_token: linkToken });
  } catch (err) {
    console.error("[create-link-token]", err);
    return NextResponse.json(
      { error: "Failed to create link token" },
      { status: 500 }
    );
  }
}
