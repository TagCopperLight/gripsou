# Confirming payments manually

For some connectors, it may be possible to have control over the payment confirmation process. This is useful if you want to check that the user is the same at both the beginning and end of the payment validation process, or in some cases, if the updated payment object still corresponds to what you expect.

Note that the confirmation phase of a payment's validation is typically very short, and in most cases, an answer is expected **within a minute**, or the payment validation is likely to expire.

## Disable automatic payment confirmation

By default, your domain automatically confirms payments if necessary. In order to disable this behaviour, you can set the `payment.auto_confirmation` setting to `"0"`, with the following request:

```
POST /config
```

```json
{
  "payment.auto_confirmation": "0"
}
```

## Detect if a payment validation requires confirmation

When receiving a callback from the payer (for example, [here](/documentation/integration-guides/pay/initiating-a-one-time-payment-with-the-webview.md#receive-a-callback-from-the-payer) with one-time payments), you need to poll the payment status. A payment currently awaiting confirmation will have the `validating` status with the `confirm` action, as in the following example:

```
GET /payments/123
```

```json
{
  "id": 123,
  "state": "validating",
  "action": "confirm",
  ...
}
```

At this stage, you must run your checks and either confirm or deny the payment.

## Confirm a payment validation

To confirm the payment, the following request can be made:

```
POST /payments/123
```

```json
{
  "confirm": true
}
```

## Deny a payment validation

To deny the payment, the following request can be made:

```
POST /payments/123
```

```json
{
  "confirm": false
}
```

This changes the payment `state` to `rejected`, and if no other error has occurred (such as the payment confirmation request being expired), the `error_code` will be set to `confirmationRefused`.


