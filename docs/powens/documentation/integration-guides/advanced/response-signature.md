# Response signature

The API can generate [JWS](https://en.wikipedia.org/wiki/JSON_Web_Signature) tokens instead of JSON responses.

This may be useful if you or one of your clients needs to assert

* the data's origin,
* which request was used exactly,
* the timestamp the request was executed at.

{% hint style="info" %}
Signed responses need to be enabled. Contact us.
{% endhint %}

## Get signed responses <a href="#get-signed-responses" id="get-signed-responses"></a>

To get a signed response, add the following query parameter to your request:

```
sign_response=true
```

## Token format <a href="#token-format" id="token-format"></a>

As any JWS, the structure is `header.payload.signature`, where

* `header` is a base64-encoded JSON with information about the signature process (see [Verify token signature](/documentation/integration-guides/advanced/response-signature.md#verify-token-signature)),
* `payload` is a base64-encoded JSON with the following structure:

  ```json
  {
      "request_url": ...,
      "response_timestamp": ...,
      "response_payload": ...,
  }
  ```
* `signature` is a base64-encoded bytes section.

## Verify token signature <a href="#verify-token-signature" id="verify-token-signature"></a>

1. Get the `key_url` in the header,
2. Fetch the key (see [Get a key](/documentation/integration-guides/advanced/response-signature.md#get-a-key)),
3. Check if the `deprecated` field is `null`,
4. Use the `public_key` field to check the signature using your favorite JWS library.

## Keys resource <a href="#keys-resource" id="keys-resource"></a>

### List keys <a href="#list-keys" id="list-keys"></a>

The list of past and present keys can be obtained at

```
/sign-keys
```

### Get a key <a href="#get-a-key" id="get-a-key"></a>

```
GET /sign-keys/{key_id}
```

#### Keys format <a href="#keys-format" id="keys-format"></a>

| Property    | Type             | Description                                                                      |
| ----------- | ---------------- | -------------------------------------------------------------------------------- |
| id          | Number           | ID of the key.                                                                   |
| public\_key | String           | PEM of the public key.                                                           |
| deprecated  | DateTime or null | If set, this key is deprecated and any signature using it should not be trusted. |


