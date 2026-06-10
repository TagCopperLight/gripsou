# Implementing your own payment validation webview

{% hint style="danger" %}
**This guide assumes you are authorized to implement your own webview**. If you don't know whether you are or not, ask your commercial contact about it.
{% endhint %}

{% hint style="info" %}
This guide assumes that you have the following elements:

* A Powens domain with Pay enabled.
* A payment, regardless of its type, with the `"created"` status.
  {% endhint %}

A payment validation webview must be isolated, with a defined role and behaviour whatever its design integration is. This role is described here, through specific steps and conditions the webview must traverse to validate the current operation on a payment.

{% @mermaid/diagram content="sequenceDiagram
participant u as End User
participant w as Webview
participant a as API

```
w->>a: Get payment status
a->>w: Provide the payment status

alt Payment state is "created"
    alt Connector is unset on payment
        w->>a: Get eligible connectors
        a->>w: Provide eligible connectors
        w->>u: Display eligible connectors
        u->>w: Pick connector
    else
        w->>a: Get connector information
        a->>w: Provide connector information
    end

    w->>w: Pick a validation mechanism for the connector
    alt Validation mechanism is not webauth and not white label
        w->>a: Set the connector to the payment
        a->>w: Acknowledge connector setting

        break Validation on webview stops
            w->>u: Redirect to Powens' webview
        end
    end

    alt Not white label
        w->>a: Check payment terms
        a->>w: Provide the payment terms status

        alt Terms are not accepted
            w->>a: Get terms
            a->>w: Provide terms
            w->>u: Display terms
            u->>w: Accept terms
            w->>a: Accept terms
            a->>w: Signal successful acceptation of terms
        end
    end

    w->>a: Request payment fields for connector
    a->>w: Provide payment fields for connector

    alt Fields are required
        w->>u: Request values for fields
        u->>w: Provide values for fields
    end

    alt Payer is required
        w->>u: Request account identification for payer
        u->>w: Provide account identification for payer
    end

    w->>a: Validate the payment with additional fields
    a->>w: Signal successful validation for the payment
end

loop Interactive steps are required
    alt Current step is redirect
        w->>u: Redirect the end user to the redirect URL
        u->>w: Return from redirect URL

        w->>a: Request payment status
        a->>w: Provide payment status
    end

    alt Current step is decoupled
        w->>u: Warn the end user
        par
            u->>u: Validate the decoupled challenge
        and
            loop Current step is decoupled
                w->>w: Wait for 5 seconds
                w->>a: Request payment status
                a->>w: Provide payment status
            end
        end
    end

    alt Current step is additionalInformationNeeded
        w->>u: Request values for fields
        u->>w: Provide values for fields
        w->>a: Provide values for fields
        a->>w: Provide payment status
    end

    alt Current step is psuValidation
        w->>u: Request user validation
        alt User agrees
            u->>w: Provide validation
            w->>a: Provide user validation
        else
            u->>w: Provide denial
            w->>a: Provide user denial
        end

        a->>w: Provide payment status
    end
end" %}
```

## Get the payment's current state

At startup, the webview must get the current state of the payment:

* If the payment's state is `created`, then the webview can do the steps to [validate the payment](#validate-the-payment).
* If the payment's state is `validating` and the current action is **not** `confirm`, then the webview can continue to [handle interactive steps](#handle-interactive-steps).
* Otherwise, the payment is unsuitable for validation by the webview, and the end user should be redirected to the final redirect URL with a suitable state.

Note that this request is also required to get other information regarding the payment, e.g. to determine the constraints applied to obtain eligible connectors.

{% hint style="warning" %}
**The Pay API does not support changing webviews during a single payment validation flow.** If the payment is already in the `validating` state, this guide assumes that the initiation payment validation was done by the same webview, and either the end user has reloaded the page (e.g. resumed the flow due to a client-side crash), or came back from a redirect flow with the bank.
{% endhint %}

## Validate the payment

This section is required if the payment is currently in the `created` state.

Validating the payment is about placing it in a state where we have to answer interactive steps. In order to do this, we must prepare a few properties before validating the payment.

### Select a connector for the payment

If the connector isn't set yet on the payment, i.e. if `connector_uuid` is set to `null` on the current status of the payment, you need to pick a connector for the payment. In order to find available connectors for making payments, you need to make the following request:

```
GET /connectors
```

```json
{
  "connectors": [
    {
      "id": 1234,
      "name": "Arkéa Banking Services",
      ...
      "payment_settings": {
        "available_validate_mechanisms": ["webauth"],
        ...
      }
    },
    ...
  ]
}
```

Connectors supporting the Pay product, identified by having `"pay"` in its `products` list, will define a `payment_settings` object, which present Pay constraints and features for this specific connectors. **You need to filter them on the client side, depending on the payment**:

* The connector must have `"pay"` in its `products` list.
* The payment's number of instructions must be less or equal to `maximum_number_of_instructions` from the connector's `payment_settings`.
* For all instructions of the payment:
  * The instruction's `execution_date_type` value must be present in the `execution_date_types` within the connector's `payment_settings`.
  * The instruction's scheme\_name from beneficiary value must be present in the connector's `beneficiary_types` attribute in `payment_settings`.
  * If the instruction has an `execution_date_type` set to `periodic`, the `frequency` is present in `execution_frequencies` from the connector's `payment_settings`.

Beyond these standard filters, you can also apply yours depending on your configuration:

* If you want to avoid having to ask the end user for their IBAN, you can avoid connectors with the `providing_payer_account` set to `mandatory`.
* If you want to avoid payments ending in the `accepted` state, you can ensure that every instruction has an execution date type that isn't included in the connector's `partial_status_tracking` list.

{% hint style="info" %}
If you want to get the top connectors for Pay in terms of number of payments in the last month, in case you want to display them on top, you can request such connectors with the following request:

```
GET /connectors?top=10&top_key=payments
```

Note that this request may return less than the number of connectors specified in the `top` parameter, for example it may return 7 connectors if all payments created in the last month have been affected only 7 connectors out of all possible connectors.
{% endhint %}

### Select a validation mechanism

The connector you've chosen provides a given set of validation mechanisms, in the `available_validate_mechanisms` attribute of the `payment_settings` at connector level. It is recommended to check which validation mechanisms you want to use at this stage.

{% hint style="warning" %}
If you're not a white label, you must either restrict the connector list to connectors bearing the `webauth` (or any mechanism starting with `webauth_`) validation mechanism, or set the connector to the payment and redirect to Powens' webview, as you are not allowed to handle non-`webauth` validation mechanisms in your webview.\
\
Note that the procedure stops here if you redirect to Powens' webview at this stage. You are not to validate terms for the payment; Powens' webview will take care of this.
{% endhint %}

### Validate terms for the payment

{% hint style="warning" %}
If you are a white label, this section is optional.
{% endhint %}

First, the terms of service must be accepted by the end user. In order to do so, you must do the following call:

```
GET /payments/{paymentId}/terms
```

{% tabs %}
{% tab title="Terms of service have not been accepted yet" %}
If the `to_sign` attribute is **both present and set to `true`**, then the terms of service are to be accepted by the end user.

```json
{
  "to_sign": "true",
  ...
}
```

{% endtab %}

{% tab title="Terms of service have been accepted" %}
If the `to_sign` attribute is **either absent or set to `false`**, then the terms of service have already been accepted.

```json
{
  "id": 4,
  "version": "budgea-004",
  "created": "2019-08-02 16:57:16",
  "deleted": null,
  "id_file": 5
}
```

{% endtab %}
{% endtabs %}

If the terms of service have not been accepted yet, you can get the content to display to the end user by making the following request:

```
GET /terms
```

```json
{
  "terms": {
    "id": {idTerms},
    ...
  },
  "content": "Conditions générales d'utilisation de Budgea Bank & Pay & Bill...",
  "language": "fr"
}
```

In order to signify the acceptance of the terms of service for the payment by the end user, you can make the following request:

```
POST /payments/{paymentId}/terms
```

```json
{
  "id_terms": {idTerms}
}
```

```json
{
  "success": "ok"
}
```

### Prepare the expected fields

In order to check if fields are to be sent to the connector, you need to get the connector fields by making the following request:

```
GET /connectors/{connectorUUID}?expand=payment_fields
```

```json
{
  "id": 123,
  ...
  "payment_fields": [
    {
      "name": "website",
      "label": "Cas d'usage",
      "regex": null,
      "type": "list",
      "required": false,
      "auth_mechanisms": ["webauth"],
      "values": [
        {
          "label": "Particuliers",
          "value": "par",
        },
        ...
      ]
    },
    ...
  ],
  ...
}
```

The website field should be requested from the end user if [the validation mechanism chosen beforehand](#select-a-validation-mechanism) is present in the `auth_mechanisms` array in the field definition.

{% hint style="danger" %}
Regardless of whether you are a white label or not, **you MUST use front encryption on all fields** before transmitting them. See [End-to-end encryption](/documentation/integration-guides/advanced/end-to-end-encryption.md) for more information.
{% endhint %}

### Prepare the payer account

{% hint style="info" %}
If the connector's UUID was already provided in the payment by the webview's client, you need to request the connector's information here by calling `GET /connectors/{connectorUUID}`.
{% endhint %}

If `providing_payer_account` in the connector's `payment_settings` is set as `mandatory`, then the payer's identification must be requested from them.

### Send the validation request

From the previous sections, you now have obtained the following information for validating the payment from the end user:

* The connector UUID (if it wasn't already set).
* The validate mechanism.
* The field values, passed through [end-to-end encryption](/documentation/integration-guides/advanced/end-to-end-encryption.md) (if at least one is set).
* The payer account identification (if it is required).
* The callback URL for `redirect` actions (as `webview_url`).

You must prepare a `webview_url`, in order to redirect the end user back to your webview to continue the validation process for the payment after `redirect` actions. This URL can contain query parameters which will be included in the callback.

{% hint style="warning" %}
In case of multiple redirect steps, the end user will always be redirected to the same webview URL as provided in the validation request. Please ensure that you don't have nonces in said URL.
{% endhint %}

You can now validate the payment, in order to pass it from the `created` state to `validating`:

```
POST /payments/{paymentId}
```

{% tabs %}
{% tab title="With all options" %}

```json
{
  "connector_uuid": "{connectorUUID}",
  "validate_mechanism": "webauth",
  "fields": {
    "website": "eyJh..."
  },
  "payer": {
    "scheme_name": "iban",
    "identification": "FR76...",
    "label": "M. Jean DUPONT"
  },
  "webview_url": "https://example.org/payment-validation-webview?redirect_url=...&state=123&id_payment=456",
  "validated": true
}
```

{% endtab %}

{% tab title="Connector already selected, no additional parameters" %}

```json
{
  "validate_mechanism": "webauth",
  "webview_url": "https://example.org/payment-validation-webview?redirect_url=...&state=123&id_payment=456",
  "validated": true
}
```

{% endtab %}
{% endtabs %}

```json
{
  "id": {paymentId},
  "state": "validating",
  ...
}
```

The payment is now initiated, and interactive steps need to be taken for the payment to be fully validated.

## Handle interactive steps

Either after successfully validating a payment in the `created` state or resuming validation on a payment in the `validating` state, interactive steps need to be taken towards continuing the operation.

The current validation step is represented by the `action` property of the payment.

### "redirect" action (redirect flow)

This means that a redirect flow is to be accomplished by the end user. In this case, you must redirect the end user to the URL present in the `validate_uri` attribute of the payment.

{% hint style="warning" %}
The URL **MUST NOT** be used in an iframe, only in full redirect, as it might be app-to-app compatible on mobile devices.
{% endhint %}

At the end of the redirect flow, the end user will be redirected back to the webview through the URL you've defined in the `webview_url` attribute of the validation request.

### "decoupled" action (validation on other channel)

This means that a validation has been requested through another channel, such as a notification in a mobile application, or a link sent by e-mail or SMS. In this case, you must inform the end user that the validation is taking place, then request a check on the decoupled validation status with a 10 second delay, using the following request:

```
POST /payments/123
```

```json
{
  "resume": true
}
```

{% hint style="info" %}
The 10 second timer should start **after the response is received**. For efficiency, some connectors may internalize part of the polling, which means the request defined above could take more than 10 seconds.
{% endhint %}

### "additionalInformationNeeded" action (temporary values required)

This means that an additional information is required from the end user, such as one-time passwords or the identifier of the account to select for the payment. In this case, you must get the list of fields to ask the end user.

For example, the payment will resemble this:

```json
{
    "id": 123,
    "state": "validating",
    "action": "additionalInformationNeeded",
    ...,
    "fields": [
      {
        "name": "account_id",
        "type": "list",
        "label": "Please choose your payment account",
        ...
      }
    ],
    ...
}
```

And, in order to submit the values picked by the end user back to the API, a request such as this one must be made:

```
POST /payments/123
```

```json
{
  "fields": {
     "account_id": "FR76..."
  }
}
```

### "psuValidation" action (payment request summary suggested)

This means that presenting a summary of the payment to the end user and letting them choose whether or not they want to pursue the validation flow is recommended at this point. This is mostly used when no redirect flow is available to do this, but a webview may emulate end user consent on such actions.

In order to communicate that the end user consents to pursuing the validation flow, the following request should be made:

```
POST /payments/123
```

```json
{
  "psu_validate": true
}
```

If however, the end user chooses not to pursue the validation flow, the following request should be made:

```
POST /payments/123
```

```json
{
  "psu_validate": false
}
```

### "confirm" action (client confirmation required)

This means that payment validation confirmation is expected from the client. This must be considered as a `"pending"` payment state by the webview, which should redirect the end user to the client redirect URL and state.

## Validate your implementation with the test connector use cases

Different use cases are provided with the test connector to trigger specific validation mechanisms during the validation process. This will allow you to verify that you have correctly implemented the different [interactive steps](#handle-interactive-steps).

### List all available use cases

```
GET /connectors/338178e6-3d01-564f-9a7b-52ca442459bf?expand=payment_fields
```

```json
{
  "id": 59,
  "name": "Connecteur de test",
  ...
  "payment_fields": [
    ...
    {
      "name": "use_case_pay",
      "label": "Use case",
      "regex": null,
      "type": "list",
      "required": false,
      "auth_mechanisms": [
        "webauth"
      ],
      "connector_sources": [
        "openapi"
      ],
      "values": [
        {
          "label": "Legacy (custom behaviour)",
          "value": "legacy"
        },
        {
          "label": "Webauth redirection",
          "value": "redirect"
        },
        {
          "label": "Decoupled with successful validation",
          "value": "decoupled"
        },
        {
          "label": "Decoupled with cancelled validation",
          "value": "decoupled_cancelled"
        },
        {
          "label": "Decoupled with expired validation",
          "value": "decoupled_expired"
        },
        {
          "label": "One time password (SMS)",
          "value": "otp_sms"
        },
        {
          "label": "OTP + Decoupled",
          "value": "otp_plus_decoupled"
        },
        {
          "label": "Payment account choice",
          "value": "account_choice"
        },
        {
          "label": "Webauth redirection without explicit confirmation",
          "value": "redirect_no_confirmation"
        }
      ]
    }
  ]
```

{% hint style="info" %}
The field `openapiwebsite` can be ignored when initiating payments.
{% endhint %}

### How to initiate a payment with a use case

In order to choose a use case for your payment on the test connector, you need to provide it as part of the [expected fields](#prepare-the-expected-fields).&#x20;

Here's an example of how to initiate a payment with the `redirect` use case.

```
POST /payments/{payment_id}
```

```json
{
    "connector_uuid": "338178e6-3d01-564f-9a7b-52ca442459bf",
    "validation_mechanism": "webauth",
    "fields": {
        "use_case_pay": "redirect"
    },
    "validated": true,
    "webview_url": "{{webview_url}}"
}
```

From there, the payment will follow a specific sequence of required actions from your part in order to be validated.

In the following sections we will see the specifities of each available use case.

### "redirect" : Validating a payment with a single redirection

Upon validation, the payment enters the `validating` state with a `redirect` action. The redirection URI is provided in the `validate_uri` field.

```
GET /payments/{payment_id}
```

```
{
    "id": {payment_id},
    "state": "validating",
    "action": "redirect",
    "validate_uri": "https://biapi.pro/2.0/webauth/callback?state=...&authFactorValue=AUTHENTICATION_VALIDATED",
    ...
}
```

You need to redirect the end user to the provided address, which will allow the payment to be validated and change its state to `done`. After which your end user would be redirected to `webview_url`.

### "decoupled": Validating a payment with a decoupled authorization

This use case will trigger a decoupled validation and ends with a payment in the state `done`.

Upon validation, the payment enters the `validating` state with a `decoupled` action. The `error_description` field contains an example description you could get from a real connector. You don't really have to validate the operation anywhere here, this is just an example for you to display in your validation webview.

```
GET /payments/{payment_id}
```

```
{
    "id": {payment_id},
    "state": "validating",
    "action": "decoupled",
    "error_description": "Please confirm the transaction in the phone app.",
    ...
}
```

From here you can poll the payment until its state changes to `done`. The validation takes approximately 10 seconds to occur.

```
POST /payments/{payment_id}
```

```json
{
    "resume": true
}
```

```json
{
    "id": {{payment_id}},
    "state": "done",
    "action": null,
    ...
}
```

### "decoupled\_cancelled": Validating a payment with a cancelled decoupled authorization

This use case will trigger a decoupled validation and simulate a cancellation by the PSU in the decoupled channel.

Upon validation, the payment enters the `validating` state with a `decoupled` action.&#x20;

```
GET /payments/{payment_id}
```

```
{
    "id": {payment_id},
    "state": "validating",
    "action": "decoupled",
    "error_description": "Please confirm the transaction in the phone app.",
    ...
}
```

After approximately 10 seconds, the payment state will change to `rejected`, with the `error_code` `CancelledByUser`.

```
POST /payments/{payment_id}
```

```json
{
    "resume": true
}
```

```json
{
    "id": {{payment_id}},
    "state": "done",
    "action": null,
    "error_code": "CancelledByUser",
    "error_description": "The decoupled validation has been cancelled by the PSU
    ...
}
```

### "decoupled\_expiration": Validating a payment with an expired decoupled authorization

This use case will trigger a decoupled validation and simulate an expiration of the authorization process.

Upon validation, the payment enters the `validating` state with a `decoupled` action.&#x20;

```
GET /payments/{payment_id}
```

```
{
    "id": {payment_id},
    "state": "validating",
    "action": "decoupled",
    "error_description": "Please confirm the transaction in the phone app.",
    ...
}
```

After approximately 20 seconds, the payment state will change to `rejected`, with the `error_code` `authenticationFailed`.

```
POST /payments/{payment_id}
```

```json
{
    "resume": true
}
```

```json
{
    "id": {{payment_id}},
    "state": "rejected",
    "action": null,
    "error_code": "authenticationFailed",
    "error_description": "The decoupled validation has expired.",
    ...
}
```

### "otp\_sms": Validating a payment with a one time password

This use case will require the end user to input a one time password.

Upon validation, the payment enters the `validating` state with an `additionalInformationNeeded` action. The one time password is requested in the `fields` key of the response.

```
GET /payments/{{payment_id}}
```

```json
{
    "id": {{payment_id}},
    "state": "validating",
    "action": "additionalInformationNeeded",
    "fields": [
        {
            "name": "openapisms",
            "type": "text",
            "label": "Please enter the one time password sent to phone number (+33)6 12 34 56 78 (code = 1234).",
            "regex": null,
            "required": true,
            "default": null
        }
    ],
    ...
}
```

From here there are two possibilities:

* Provide the code `1234` to validate the payment. The payment state changes to `done`.

```
POST /payments/{{payment_id}}
```

```json
{
    "fields": {
        "openapisms": "1234" 
    }
}
```

```json
{
    "id": {{payment_id}},
    "state": "done",
    "action": null,
    ...
}
```

Or you can provide anything else to reject the payment with the `authenticationFailed` `error_code`.

```
POST /payments/{{payment_id}}
```

```json
{
    "fields": {
        "openapisms": "a wrong password" 
    }
}
```

```json
{
    "id": {{payment_id}},
    "state": "rejected",
    "action": null,
    "error_code": "authenticationFailed",
    ...
}
```

### "otp\_plus\_decoupled": Validating a payment with a chained one time password and decoupled authorizations

This use case simulates a payment validation chaining a one time password prompt followed by a decoupled validation. This is useful to check that your webview implementation supports more than one validation mechanism at a time.

This chains the use case "One time password (SMS)" and "Decoupled with successful validation".

### "account\_choice": Validating a payment with a choice of payment account

This use case triggers a payment validation where the PSU needs to select the payment account to debit for this operation. This is done through an additional field of type `list`.&#x20;

Upon validation, the payment enters the `validating` state with `additionalInformationNeeded` action. The dynamic field exposes a list of available payment accounts.

```
GET /payments/{{payment_id}}
```

```json
{
    "id": {{payment_id}},
    "state": "validating",
    "action": "additionalInformationNeeded",
    "fields": [
        {
            "name": "account_id",
            "type": "list",
            "label": "account choice bank message",
            "regex": null,
            "required": true,
            "default": null,
            "values": [
                {
                    "value": "main",
                    "label": "My checking account (EX6713038781895300290000074)"
                },
                {
                    "value": "snd",
                    "label": "My secondary checking account (EX5813038781895400400000074)"
                }
            ]
        }
    ],
    ...
}
```

Depending on the chosen account, the operation result will vary:

* If the main account is chosen, the payment will be successfully authorised and the state will change to done.

```
POST /payments/{{payment_id}}
```

```json
{
    "fields": {
        "account_id": "main" 
    }
}
```

```json
{
    "id": {{payment_id}},
    "state": "done",
    "action": null,
    ...
}
```

* If the `snd` account is chosen, the payment will be rejected with the `invalidEmitter` `error_code`.

```
POST /payments/{{payment_id}}
```

```json
{
    "fields": {
        "account_id": "snd" 
    }
}
```

```json
{
    "id": {{payment_id}},
    "state": "rejected",
    "error_code": "invalidEmitter",
    "error_description": "Please select the main account.",
    ...
}
```

### "redirect\_no\_confirmation": Validating a payment with a single redirection and no explicit client confirmation

This use case can be useful if you have [disabled automatic payment confirmation](/documentation/integration-guides/pay/advanced/confirming-payments-manually.md) on your domain, but still wants to test a case where such a confirmation is not available.

The validation mechanism is the same as the redirect use case, with the exception that the payment state will change to done without a `confirm` action beforehand.

### "legacy": Validating a payment with intermediary states

The legacy use case allows you to specify the states that the payment will go through during its lifecycle. This can be used to test the [webhooks](/documentation/integration-guides/webhooks.md), an early rejection or a pending state. This use case is fully covered in the following guide :[Validating your implementation with the test connector](/documentation/integration-guides/pay/validating-your-implementation-with-the-test-connector.md).&#x20;

It's useful whether you use your own webview or not. This use case is chosen by default if do not provide a value for the `use_case_pay` field when validating a payment on this connector.


