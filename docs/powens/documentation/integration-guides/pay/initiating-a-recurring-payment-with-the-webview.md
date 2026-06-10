# Initiating a recurring payment with the Webview

{% hint style="warning" %}
This feature must be enabled by your commercial contact.
{% endhint %}

{% hint style="warning" %}
Note that this guide assumes you have the following information on hand:

* A Powens domain with Pay enabled.
* A Powens domain client with client identifiers, thereafter named `clientId` and `clientSecret`.
* A URL to redirect the end user to at the end of the process, registered with the client, thereafter named `redirectURL`.
* An optional state that will be transmitted to your redirect URL, thereafter named `optionalRedirectState`.
  {% endhint %}

Recurring payments are payments executed periodically by the bank. Once initiated, the bank will create instances of the recurring payment according to the provided schedule, without the need for the end user to validate the execution.

The basic initiation workflow is the same as in [Initiating a one-time payment with the Webview](/documentation/integration-guides/pay/initiating-a-one-time-payment-with-the-webview.md), with the following notable differences:

* The payment object only contains one instruction, with the execution date type being `"periodic"`, and additional properties representing the schedule to be set.
* The payment status needs to be interpreted differently.

The basic initiation workflow will be the following:

<figure><img src="/files/k6iuWiZlYorPwVg6GHw2" alt=""><figcaption></figcaption></figure>

## Obtain a token suitable for creating recurring payments

In order to create recurring payments, we need a special access token with the `payments:admin` scope, obtained using client credentials:

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

See [Service Tokens](https://docs.powens.com/api-reference/overview/authentication#service-tokens) for more information.

## Create a recurring payment

You can now create a recurring payment request with the following request:

```
POST /payments
```

{% tabs %}
{% tab title="Monthly recurring payment" %}

```json
{
  "client_redirect_uri": "{redirectURL}",
  "client_state": "{optionalRedirectState}",
  "instructions": [
    {
      "label": "ABC123 Monthly Rent",
      "amount": 1050,
      "currency": "EUR",
      "execution_date_type": "periodic",
      "frequency": "monthly",
      "start_date": "2023-09-04",
      "end_date": "2025-01-01",
      "beneficiary": {
        "scheme_name": "iban",
        "identification": "FR76XXXXXXXXXXXXXXX",
        "label": "ACME Corp."
      },
      "beneficiary_identity": {
        "kind": "corporate",
        "org_name": "ACME Corp.",
        "org_legal_status": "SARL",
        "scheme_name": "siren",
        "identification": "012345678"
      }
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
  }
} 
```

{% endtab %}

{% tab title="Daily recurring payment" %}

```json
{
  "client_redirect_uri": "{redirectURL}",
  "client_state": "{optionalRedirectState}",
  "instructions": [
    {
      "label": "ABC123 Daily fixed server costs",
      "amount": 3.50,
      "currency": "EUR",
      "execution_date_type": "periodic",
      "frequency": "daily",
      "start_date": "2023-09-01",
      "end_date": "2024-09-01",
      "beneficiary": {
        "scheme_name": "iban",
        "identification": "FR76XXXXXXXXXXXXXXX",
        "label": "ACME Corp."
      },
      "beneficiary_identity": {
        "kind": "corporate",
        "org_name": "ACME Corp.",
        "org_legal_status": "SARL",
        "scheme_name": "siren",
        "identification": "012345678"
      }
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
  }
} 
```

{% endtab %}
{% endtabs %}

```json
{
  "id": {paymentId},
  "state": "created",
  "error_code": null,
  "error_description": null,
  …
}
```

A `payer_identity` for the recurring payment request and a `beneficiary_identity` for every instruction are required and must contain information on either the payer (which you redirect to the webview) or the beneficiary (matching the routing information). For the definition of such objects, see the [Identity object](https://docs.powens.com/api-reference/products/payments/payments#identity-resource) definition.

The following are examples of different identity kinds with Pay:

{% tabs %}
{% tab title="Individual" %}

```json
{
  "kind": "individual",
  "external_ref": "MY-CUSTOMER-REFERENCE-012345678",
  "first_name": "Jean",
  "last_name": "Dupont",
  "nationality": "FR",
  "postal_address": "Appartement 25\nEntrée B Résidence Les Iris\n3 Boulevard du Levant\n95220 HERBLAY"
}
```

{% endtab %}

{% tab title="Company" %}

```json
{
  "kind": "corporate",
  "org_name": "Powens",
  "org_legal_status": "SAS",
  "org_hq_address": "84 RUE BEAUBOURG\n75003 PARIS 3\nFRANCE",
  "scheme_name": "siren",
  "identification": "749867206"
}
```

{% endtab %}
{% endtabs %}

See the [`POST /payments` endpoint reference](https://docs.powens.com/api-reference/products/payments/payments#initiate-a-payment) and [the `PaymentInitRequest` object description](https://docs.powens.com/api-reference/products/payments/payments#paymentinitrequest-object) for more information on the payload or returned information.

## Obtain the recurring payment validation token

In order for the payer to be able to validate the recurring payment request, you first need to create a token scoped to validate the created recurring payment specifically. You can do this using the token created in [Obtain a token suitable for creating payments](#obtain-a-token-suitable-for-creating-payments):

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

See the [`POST /payments/{id}/scopedtoken` endpoint reference](https://docs.powens.com/api-reference/products/payments/payments#generate-a-payment-scoped-token) for more information.

## Build the recurring payment validation URL

Now that you have the recurring payment validation token, you can create the webview URL by taking the webview URL and adding the following parameters to it:

* `domain`: your client domain.
* `client_id`: the client identifier for your application (`clientId`).
* `redirect_uri`: the same redirect URL you've used when creating the recurring payment (`redirectURL`).
* `state`: the same state you've used when creating the recurring payment (`optionalRedirectState`).
* `code`: The scoped token you've generated on your previous request to the API.
* `payment_id`: the identifier of the recurring payment.

This will make you obtain a URL of the form:

```
https://{domain}.biapi.pro/2.0/auth/webview/payment?client_id={clientId}&redirect_uri={redirectURL}&state={optionalRedirectState}&code={scopedAccessToken}&payment_id={paymentId}
```

You can redirect your payer to this URL.

## Receive a callback from the payer

Once the payer has either completed the recurring payment validation flow, or has cancelled from either our Webview or the bank's interface, they will go on the callback URL you have configured on the payment with the following parameters:

* `state`: the optional client state you have configured on the recurring payment, i.e. `{optionalClientState}`.
* `id_payment`: the identifier of the recurring payment that the user comes from.
* `error` (*optional*): set to "`cancelled`" if the payer has cancelled the recurring payment from our Webview.
* `error_code` (*optional*): set to the recurring payment's error code, if the payment has been cancelled or rejected by the bank.
* `bank_message` (*optional*): set to the bank message, if available.
* `payment_state` (*optional*): the state of the recurring payment, if the payer has been redirected by the bank.

For security reasons, following such a callback from the payer, it is recommended to check the recurring payment's state manually; see [Get the recurring payment status](#get-the-recurring-payment-status).

## Check on a recurring payment's state

During and after the initiation of a recurring payment, you may want to check on the status of said recurring payment, or to get data back from the recurring payment initiation request.

### Receive recurring payment updated events using webhooks (recommended method)

In order to receive updates when a recurring payment switches states, it is recommended to [set up the Payment Updated webhook](/documentation/integration-guides/pay/getting-started-with-pay.md#configure-the-payment-state-updated-webhook) and wait for events regarding recurring payments.

{% hint style="warning" %}
Webhook events will only be triggered during a background refresh / synchronization of the recurring payment's state.
{% endhint %}

For more information, see [Webhooks](https://docs.powens.com/api-reference/products/payments/payments#webhooks) in the Payments API reference.

### Get the recurring payment status

{% hint style="warning" %}
This method is **not recommended for polling** the recurring payment's status regularly, it is recommended to wait for incoming webhook events to this end.

However, it is recommended for when receiving a callback regarding a recurring payment from an end user, or for debugging purposes.
{% endhint %}

In order to get a given recurring payment's status, you can call the `GET /payments/{id}` endpoint, with the identifier of the recurring payment. See [API endpoints](https://docs.powens.com/api-reference/products/payments/payments#api-endpoints) for more information.

### Process the recurring payment status

In the resulting recurring payment resource, you are to get the `state` property, and do the following:

* If the status is `pending`, it is currently active and being executed periodically.
* If the status is `expired`, it means that the recurring payment will not be updated anymore.
* If the status is `accepted`, it means that the initiation was successful but the bank will not provide further updates; if you accept the risks, you can consider the recurring payment as active or done.
* If the status is `done`, it means that all required executions have been done.
* If the status is `rejected`, it means that the recurring payment has been rejected by the bank, or stopped by the end user through the bank.

{% hint style="info" %}
A recurring payment with the `accepted` status could still be rejected by the bank (e.g. for insufficient funds at execution time), however we can no longer poll the recurring payment's status on our side. If you want to avoid such cases, you can identify connectors with this behaviour by checking the `partial_status_tracking` property of connectors; see [Listing connectors with Pay enabled programmatically](/documentation/integration-guides/pay/advanced/listing-connectors-with-pay-enabled-programmatically.md).
{% endhint %}

See the [Payment object](https://docs.powens.com/api-reference/products/payments/payments#payment-object) definition for reference.


