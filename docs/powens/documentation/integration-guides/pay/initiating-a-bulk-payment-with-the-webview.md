# Initiating a bulk payment with the Webview

{% hint style="warning" %}
Note that this guide assumes you have the following information on hand:

* A Powens domain with Pay enabled.
* A Powens domain client with client identifiers, thereafter named `clientId` and `clientSecret`.
* A URL to redirect the end user to at the end of the process, registered with the client, thereafter named `redirectURL`.
* An optional state that will be transmitted to your redirect URL, thereafter named `optionalRedirectState`.
  {% endhint %}

Bulk payments are payments with multiple instructions to be executed once by the bank. They are equivalent to initiating multiple one-time payments, except that there is only one connector and one validation for all of the instructions.

Akin to one-time payments, the instructions of a bulk payment can have different types:

* **"First open day" payments**: classic payments usually executed within a few business days (SEPA Credit Transfers, GB BACS, GB CHAPS, GB Faster Payments, ...).
* **"Instant" payments**: payments usually executed within a few minutes (SEPA Instant Credit Transfers).
* **"Deferred" payments**: classic payments only executed at a provided future date.

{% hint style="warning" %}
Currently, all instructions of a given payment must have the same type, and for deferred bulk payments, all instructions must be executed on the same day.
{% endhint %}

The basic initiation workflow is the same as in [Initiating a one-time payment with the Webview](/documentation/integration-guides/pay/initiating-a-one-time-payment-with-the-webview.md), with the following notable differences:

* The payment object contains two or more instructions.
* The payment status needs to be interpreted differently.

The basic initiation workflow will be the following:

{% @mermaid/diagram content="sequenceDiagram
participant u as PSU (Payer)
participant c as Your app/service
participant w as Powens Webview
participant a as Powens API
participant b as Bank

u->>c: Initiate a bulk payment
c->>a: Create a bulk payment request
a->>c: Bulk payment request
c->>u: Webview URL for<br>the bulk payment request
u->>w: Open webview URL in browser
w->>b: Redirect PSU to the bank
b->>w: Validation result
w->>a: Validation result
a->>c: Bulk payment status" %}

## Obtain a token suitable for creating bulk payments

In order to create bulk payments, we need a special access token with the `payments:admin` scope, obtained using client credentials:

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

## Create a bulk payment

You can now create a bulk payment request with the following request:

```
POST /payments
```

{% tabs %}
{% tab title="Classic bulk payment" %}

```json
{
  "client_redirect_uri": "{redirectURL}",
  "client_state": "{optionalRedirectState}",
  "instructions": [
    {
      "label": "ABC123 ACME Corp Mar 2020 Charges",
      "amount": 550,
      "currency": "EUR",
      "execution_date_type": "first_open_day",
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
    },
    {
      "label": "DEF456 CMEA Corp Mar 2020 Charges",
      "amount": 300,
      "currency": "EUR",
      "execution_date_type": "first_open_day",
      "beneficiary": {
        "scheme_iban": "iban",
        "identification": "FR76YYYYYYYYYYYYYYY",
        "label": "CMEA Corp."
      },
      "beneficiary_identity": {
        "kind": "corporate",
        "org_name": "CMEA Corp.",
        "org_legal_status": "SARL",
        "scheme_name": "siret",
        "identification": "876543210000025",
      }
    }
  ],
  "payer_identity": {
    "kind": "corporate",
    "org_name": "Jean-Michel-Thierry Couverture",
    "org_legal_status": "EIRL",
    "scheme_name": "siren",
    "identification": "111222333"
  }
} 
```

{% endtab %}

{% tab title="Instant bulk payment" %}

```json
{
  "client_redirect_uri": "{redirectURL}",
  "client_state": "{optionalRedirectState}",
  "instructions": [
    {
      "label": "ABC123 ACME Corp Mar 2020 Charges",
      "amount": 550,
      "currency": "EUR",
      "execution_date_type": "instant",
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
    },
    {
      "label": "DEF456 CMEA Corp Mar 2020 Charges",
      "amount": 300,
      "currency": "EUR",
      "execution_date_type": "instant",
      "beneficiary": {
        "scheme_iban": "iban",
        "identification": "FR76YYYYYYYYYYYYYYY",
        "label": "CMEA Corp."
      },
      "beneficiary_identity": {
        "kind": "corporate",
        "org_name": "CMEA Corp.",
        "org_legal_status": "SARL",
        "scheme_name": "siret",
        "identification": "876543210000025",
      }
    }
  ],
  "payer_identity": {
    "kind": "corporate",
    "org_name": "Jean-Michel-Thierry Couverture",
    "org_legal_status": "EIRL",
    "scheme_name": "siren",
    "identification": "111222333"
  }
} 
```

{% endtab %}

{% tab title="Deferred bulk payment" %}

```json
{
  "client_redirect_uri": "{redirectURL}",
  "client_state": "{optionalRedirectState}",
  "instructions": [
    {
      "label": "ABC123 ACME Corp Mar 2020 Charges",
      "amount": 550,
      "currency": "EUR",
      "execution_date_type": "deferred",
      "execution_date": "2024-01-05",
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
    },
    {
      "label": "DEF456 CMEA Corp Mar 2020 Charges",
      "amount": 300,
      "currency": "EUR",
      "execution_date_type": "deferred",
      "execution_date": "2024-01-05",
      "beneficiary": {
        "scheme_iban": "iban",
        "identification": "FR76YYYYYYYYYYYYYYY",
        "label": "CMEA Corp."
      },
      "beneficiary_identity": {
        "kind": "corporate",
        "org_name": "CMEA Corp.",
        "org_legal_status": "SARL",
        "scheme_name": "siret",
        "identification": "876543210000025",
      }
    }
  ],
  "payer_identity": {
    "kind": "corporate",
    "org_name": "Jean-Michel-Thierry Couverture",
    "org_legal_status": "EIRL",
    "scheme_name": "siren",
    "identification": "111222333"
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

A `payer_identity` for the bulk payment request and a `beneficiary_identity` for every instruction is required and must contain information on either the payer (which you redirect to the webview) or the beneficiary (matching the routing information). For the definition of such objects, see the [Identity object](https://docs.powens.com/api-reference/products/payments/payments#identity-resource) definition.

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

## Obtain the bulk payment validation token

In order for the payer to be able to validate the bulk payment request, you first need to create a token scoped to validate the created bulk payment specifically. You can do this using the token created in [Obtain a token suitable for creating payments](#obtain-a-token-suitable-for-creating-payments):

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

## Build the bulk payment validation URL

Now that you have the bulk payment validation token, you can create the webview URL by taking the webview URL and adding the following parameters to it:

* `domain`: your client domain.
* `client_id`: the client identifier for your application (`clientId`).
* `redirect_uri`: the same redirect URL you've used when creating the bulk payment (`redirectURL`).
* `state`: the same state you've used when creating the bulk payment (`optionalRedirectState`).
* `code`: The scoped token you've generated on your previous request to the API.
* `payment_id`: the identifier of the bulk payment.

This will make you obtain a URL of the form:

```
https://{domain}.biapi.pro/2.0/auth/webview/payment?client_id={clientId}&redirect_uri={redirectURL}&state={optionalRedirectState}&code={scopedAccessToken}&payment_id={paymentId}
```

You can redirect your payer to this URL.

## Receive a callback from the payer

Once the payer has either completed the bulk payment validation flow, or has cancelled from either our Webview or the bank's interface, they will go on the callback URL you have configured on the payment with the following parameters:

* `state`: the optional client state you have configured on the bulk payment, i.e. `{optionalClientState}`.
* `id_payment`: the identifier of the bulk payment that the user comes from.
* `error` (*optional*): set to "`cancelled`" if the payer has cancelled the bulk payment from our Webview.
* `error_code` (*optional*): set to the bulk payment's error code, if the payment has been cancelled or rejected by the bank.
* `bank_message` (*optional*): set to the bank message, if available.
* `payment_state` (*optional*): the state of the bulk payment, if the payer has been redirected by the bank.

For security reasons, following such a callback from the payer, it is recommended to check the bulk payment's state manually; see [Get the bulk payment status](#get-the-bulk-payment-status).

## Check on a bulk payment's state

During and after the initiation of a bulk payment, you may want to check on the status of said bulk payment, or to get data back from the bulk payment initiation request.

### Receive bulk payment updated events using webhooks (recommended method)

In order to receive updates when a bulk payment switches states, it is recommended to [set up the Payment Updated webhook](/documentation/integration-guides/pay/getting-started-with-pay.md#configure-the-payment-state-updated-webhook) and wait for events regarding bulk payments.

{% hint style="warning" %}
Webhook events will only be triggered during a background refresh/synchronization of the bulk payment's state.
{% endhint %}

{% hint style="warning" %}
Webhook events will not be emitted if only an instruction changes states, only if the payment changes states, i.e. if all instructions reach a final state.
{% endhint %}

For more information, see [Webhooks](https://docs.powens.com/api-reference/products/payments/payments#webhooks) in the Payments API reference.

### Get the bulk payment status

{% hint style="warning" %}
This method is **not recommended for polling** the bulk payment's status regularly, it is recommended to wait for incoming webhook events to this end.

However, it is recommended for when receiving a callback regarding a bulk payment from an end user, or for debugging purposes.
{% endhint %}

In order to get a given bulk payment's status, you can call the `GET /payments/{id}` endpoint, with the identifier of the bulk payment. See [API endpoints](https://docs.powens.com/api-reference/products/payments/payments#api-endpoints) for more information.

### Process the bulk payment statuses

In the resulting bulk payment resource, you are to get both the `state` property of the payment, and if it is available, the `state` property of every of its instructions. At instruction-level, if the status is not `null`, you can conclude the following:

* If the status is `pending`, the instruction is still awaiting execution.
* If the status is `rejected`, the instruction has been rejected by either the bank, or the end user through the bank.
* If the status is `accepted`, the bank will not provide further updates past the initiation for this instruction; if you accept the risks, you can consider this instruction as executed.
* If the status is `done`, the instruction has been executed by the bank.

The bulk payment's state property signifies, at a higher level, of the status of its instructions:

* If the bulk payment's state is `pending`, at least one instruction is still awaiting execution. You probably still want to check the instructions' statuses to find out if some instructions have changed state.
* If the bulk payment's state is `rejected`, all instructions are considered to have the `rejected` status.
* If the bulk payment's state is `accepted`, all instructions are considered to have the `accepted` status.
* If the bulk payment's state is `done`, all instructions are considered to have the `done` status.
* If the bulk payment's state is `partial`, at least one instruction is either `done` or `accepted`, and at least one instruction is considered to have the `rejected` status.

{% hint style="warning" %}
In the case the bank reports a `partial` status with no detail regarding the state of the instructions, the payment will be reported having the `partial` status, and all of its instructions will have the `accepted` status.
{% endhint %}

See the [Payment object](https://docs.powens.com/api-reference/products/payments/payments#payment-object) definition for reference.


