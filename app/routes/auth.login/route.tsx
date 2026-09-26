import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));
  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));
  return { errors };
};

/** Non-embedded login (only used when opening the app URL outside the Shopify Admin). */
export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-bg">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-7 shadow-pop">
        <img src="/trackback_logo.png" alt="TrackBack" className="h-10 w-auto mb-5" />
        <h1 className="text-[18px] font-semibold text-ink tracking-tight">Log in to TrackBack</h1>
        <p className="text-[13px] text-muted mt-1">Enter your Shopify store domain.</p>
        <Form method="post" className="mt-5 space-y-3">
          <label className="block">
            <span className="block text-[12px] font-semibold text-ink mb-1">Shop domain</span>
            <input
              name="shop"
              value={shop}
              onChange={(e) => setShop(e.currentTarget.value)}
              placeholder="example.myshopify.com"
              autoComplete="on"
              className="w-full h-10 px-3 rounded-md bg-bg border border-border text-[13px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
          </label>
          {errors?.shop && <p className="text-[12px] text-danger">{errors.shop}</p>}
          <button
            type="submit"
            className="w-full h-10 rounded-md text-white text-[13px] font-semibold bg-gradient-to-b from-[#7B73FF] to-[#6259EE] hover:from-[#8B85FF] hover:to-[#6C63FF]"
          >
            Log in
          </button>
        </Form>
      </div>
    </div>
  );
}
