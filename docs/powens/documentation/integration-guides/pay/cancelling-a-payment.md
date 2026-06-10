# Cancelling a payment

Depending on the type of payment and whether the connector allows it or not, it may be possible to cancel a payment through our API once it has been validated and confirmed, before it has been executed.

{% hint style="info" %}
This guide assumes you are cancelling a payment respecting the following criteria:

* The state of the payment is either `created` or `pending`.
* If the state of the payment is `pending`, the execution date type of all instructions in the payment is not `instant`.
  {% endhint %}

{% hint style="warning" %}
Note that this guide assumes you have the following information on hand:

* A Powens domain with Pay enabled.
* A Powens domain client with client identifiers, thereafter named `clientId` and `clientSecret`.
* A URL to redirect the end user to at the end of the process, registered with the client, thereafter named `redirectURL`.
* An optional state that will be transmitted to your redirect URL, thereafter named `optionalRedirectState`.
* A payment you wish to cancel, for which the identifier will be represented as `paymentId`.
  {% endhint %}

## Initiate the cancellation

You first need to request the cancellation from our API, by doing the following request:

```
POST /payments/{paymentId}
```

```json
{
  "cancel": true,
  "client_redirect_uri": "{redirectURL}",
  "client_state": "{optionalRedirectState}"
} 
```

From here, you can obtain multiple responses corresponding to multiple scenarios:

{% tabs %}
{% tab title="Cancellation successful" %}
If the cancellation could successfully be done without any validation by the end user, the response looks like the following:

```json
{
  "id": {paymentId},
  "state": "rejected",
  "error_code": "cancelledByUser",
  ...
}
```

{% endtab %}

{% tab title="End user validation required" %}
Some cancellations require a validation by the end user. In this case, the response looks like the following:

```json
{
  "id": {paymentId},
  "state": "pending",
  "state_detail": "cancelling",
  ...
}
```

{% endtab %}

{% tab title="Cancellation is not supported" %}
If the connector doesn't support cancelling the provided payment, the following response will be received:

```json
{
    "code": "notSupported",
    "description": "Bad request, please check your request parameters.",
    ...
}
```

{% endtab %}
{% endtabs %}

## Validate a payment cancellation if necessary

If the cancellation requires validation from the end user, the payment state will stays in `pending` , its `state_detail` will be `cancelling`, and the `validate_uri` field of the payment resource will be populated with a link to the PSU's bank. In this case, the PSU must be redirected to this URL.

### Receive a callback from the payer

If the payment cancellation needed an approval from the PSU, you will need to handle the callback at the end of the cancellation flow.

Once the payer has either completed the payment cancellation flow, they will go on the callback URL you have configured on the payment with the following parameters:

* `state`: the optional client state you have configured on the payment, i.e. `{optionalClientState}`.
* `id_payment`: the identifier of the payment that the user comes from.
* `error_code` (*optional*): set to the payment's error code, if the payment has been cancelled or rejected by the bank.
* `bank_message` (*optional*): set to the bank message, if available.
* `payment_state` (*optional*): the state of the payment, if the payer comes from the bank's interface.

For security reasons, it is recommended to check the payment's state manually; see [Get the payment status](/documentation/integration-guides/pay/initiating-a-one-time-payment-with-the-webview.md#get-the-payment-status).


