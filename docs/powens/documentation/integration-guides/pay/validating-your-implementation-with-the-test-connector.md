# Validating your implementation with the test connector

In order to validate your implementation, you can use the test connector which you can enable on your sandbox domain, with the UUID `338178e6-3d01-564f-9a7b-52ca442459bf`.

## Formatting the label

With this institution, you can simulate various scenarios, depending on the label of the first instruction in the payment. The label resembles this:

```
pdng/done - My payment label
```

The payment states are described on the left of the first found caret (`-`), separated from each other by slashes (`/`).

In the provided example, assuming the payment is a single "first open day" payment, once validated, it will be `"pending"` for 15 minutes, then `"done"`.

A scenario can have up to 3 different states, for which the possible values are the following:

* `pdng`: pending.
* `canc`: rejected (by the end user).
* `rjct`: rejected (by the bank, generic).
* `err`: rejected (by the bank, for an invalid amount).
* `bug`: an error will have occurred during the payment initiation.
* `done`: done.

If no final state is provided, the final state will be `"done"`.

Example scenarios are:

* `pdng/pdng/done`: the payment will be pending execution during 30 minutes, before done.
* `pdng/rjct`: the payment will be pending execution during 15 minutes, before being rejected for a generic reason.
* `err`: the payment will be rejected by the bank for an invalid amount.

## Create a first open day payment with the test connector

Here, we will create a first open day that will be `pending` then `done`. Note that this is a partial reprisal of [Initiating a one-time payment with the Webview](/documentation/integration-guides/pay/initiating-a-one-time-payment-with-the-webview.md).

### Obtain a token suitable for creating payments

In order to create payments, we need a special access token with the `payments:admin` scope, obtained using client credentials:

```
POST /auth/token
```

```json
{
  "grant_type": "client_credentials",
  "client_id": "{clientId}",
  "client_secret": "{clientSecret}",
  "scope": "payments:admin",
} 
```

```json
{
  "token": "{accessToken}",
  "scope": "payments:admin"
}
```

### Create the first open day payment

You can now create a payment request with the following request:

```
POST /payments
```

```json
{
  "uuid": "338178e6-3d01-564f-9a7b-52ca442459bf",
  "use_case_pay": "legacy",
  "client_redirect_uri": "{redirectURL}",
  "client_state": "{optionalRedirectState}",
  "instructions": [
    {
      "label": "pdng/done - ABC001 ACME PURCHASE",
      "amount": 12.34,
      "currency": "EUR",
      "execution_date_type": "first_open_day",
      "beneficiary": {
        "scheme_name": "iban",
        "identification": "FR76XXXXXXXXXXXXXXX",
        "label": "ACME Corp.",
      },
      "beneficiary_identity": {
        "kind": "corporate",
        "org_name": "ACME Corp.",
        "org_legal_status": "SARL",
        "scheme_name": "siren",
        "identification": "012345678"
      },
    }
  ],
  "payer_identity": {
    "kind": "individual",
    "first_name": "Germaine",
    "last_name": "Michu",
    "birth_date": "1963-01-01",
    "birth_city": "Paris",
    "birth_country": "FR",
    "nationality": "French"
  },
  …
} 
```

```json
{
  "id": {paymentId},
  "state": "created",
  "error_code": null,
  "error_description": null,
  …
}
```

Now we have the payment identifier, in order to validate it, we must create a webview URL and send our PSU on it.

### Obtain the payment validation token

As in the original guide, we get a token suitable for payment validation here:

```
POST /payments/{paymentId}/scopedtoken
Authorization: Bearer {accessToken}
```

```json
{
  "scope": ["payments:validate"]
}
```

```json
{
  "token": "{scopedAccessToken}",
  "scope": "payments:validate",
  "expires_in": 604800,
  "id_payment": {paymentId}
}
```

### Build the payment validation URL

Now that you have the payment validation token, you can create the webview URL by taking the webview URL and adding the following parameters to it:

* `client_id`: the client identifier for your application (`clientId`).
* `redirect_uri`: the same redirect URL you've used when creating the payment (`redirectURL`).
* `state`: the same state you've used when creating the payment (`optionalRedirectState`).
* `code`: The scoped token you've generated on your previous request to the API.
* `payment_id`: the identifier of the payment.

This will make you obtain an URL of the form:

```
https://{domain}.biapi.pro/2.0/auth/webview/{lang}/payment?client_id={clientId}&redirect_uri={redirectURL}&state={optionalRedirectState}&code={scopedAccessToken}&payment_id={paymentId}
```

You can redirect your payer to this URL.

### Receive the callback from the payer

Once the payer has either completed the payment validation flow, they will arrive on the callback URL you have configured on the payment with the following parameters:

* `state`: the optional client state you have configured on the payment, i.e. `{optionalClientState}`.
* `id_payment`: the identifier of the payment that the user comes from.
* `payment_state`: the state of the payment, set to `"pending"` here.

If your implementation is correct, following this callback, you should directly use the `GET /payments/{id}` endpoint, with the identifier of the payment, to get the current state of the payment, which is indeed `"pending"`. See [API endpoints](https://docs.powens.com/api-reference/products/payments/payments#api-endpoints) for more information.

For more details on these parameters, see [Receive the callback from the payer](/documentation/integration-guides/pay/initiating-a-one-time-payment-with-the-webview.md#receiving-a-callback-from-the-payer) in the original guide.

### Receive webhook events regarding the payment's state

After approximately 15 minutes, you will receive a `"PAYMENT_STATE_UPDATED"` webhook event advertising that the payment is now "done", with the full data regarding the payment.

{% hint style="info" %}
You can test behaviours with shorter intervals using `"instant"` payments; every phase with such payments last 15 seconds instead of 15 minutes, so your payment will have reached its final state within about one minute.
{% endhint %}

During and after the initiation of a payment, you may want to check on the status of a payment, or to get data back from the payment initiation request.

For more information, see [Webhooks](https://docs.powens.com/api-reference/products/payments/payments#webhooks) in the Payments API reference.


