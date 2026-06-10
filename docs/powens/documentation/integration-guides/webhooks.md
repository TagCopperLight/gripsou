# Webhooks

Our API offers a way to obtain data of end-users using [webhooks](https://en.wikipedia.org/wiki/Webhook). After [a user connection has been configured](/documentation/integration-guides/quick-start/add-a-first-user-and-connection.md) using our API endpoints, these callbacks are the most efficient way to get up-to-date user data.

{% hint style="warning" %} <mark style="color:orange;">We highly recommend using webhooks instead of implementing an API-polling mechanism.</mark>
{% endhint %}

### Registering webhooks <a href="#registering-webhooks" id="registering-webhooks"></a>

You can [register a webhook](/documentation/integration-guides/quick-start.md#register-a-webhook) in the [administration console](https://console.budget-insight.com/) of your domain. As many webhooks as needed can be registered.

The console also lets you test webhooks triggering and handling. For instance, after you have configured a webhook for the [`CONNECTION_SYNCED`](https://docs.budget-insight.com/reference/connections#connection-synced) event, you can test that the callback is properly triggered when a user creates a new connection to his bank accounts in the webview.

{% hint style="info" %}
Webhooks are only triggered for *permanent* users: you must have [obtained a permanent access token](https://docs.powens.com/api-reference/overview/authentication) for the user before you can receive webhook data.
{% endhint %}

### Available webhook events <a href="#available-webhook-events" id="available-webhook-events"></a>

You can subscribe to the following events:

<table><thead><tr><th width="287">Event</th><th>Description</th></tr></thead><tbody><tr><td><a href="https://docs.powens.com/api-reference/user-connections/users#user-created"><code>USER_CREATED</code></a></td><td>Emitted after a permanent user is created.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/user-connections/users#user-deleted"><code>USER_DELETED</code></a></td><td>Emitted after a user is deleted.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/user-connections/users#user-synced-deprecated"><del><code>USER_SYNCED</code></del></a></td><td><em>Deprecated.</em> Emitted after multiple connections of a user have been synced.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/user-connections/connections#connection-synced"><code>CONNECTION_SYNCED</code></a></td><td>Emitted after a connection has been synced.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/user-connections/connections#connection-deleted"><code>CONNECTION_DELETED</code></a></td><td>Emitted after a connection has been deleted.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts#accounts-fetched"><code>ACCOUNTS_FETCHED</code></a></td><td>Emitted during a sync after bank accounts have been synchronized, but before the transactions are processed.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts#account-categorized"><code>ACCOUNT_CATEGORIZED</code></a></td><td>Emitted during a sync after bank accounts have been synchronized, and after the transactions are processed.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts#accounts-synced"><code>ACCOUNT_SYNCED</code></a></td><td>Emitted during a sync after a bank account was processed, including new transactions.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts#account-disabled"><code>ACCOUNT_DISABLED</code></a></td><td>Emitted after a bank account was disabled.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts#account-enabled"><code>ACCOUNT_ENABLED</code></a></td><td>Emitted after a bank account was enabled.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts#account-found"><code>ACCOUNT_FOUND</code></a></td><td>Emitted after a new bank account was discovered.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/products/data-aggregation/account-ownerships#webhook"><code>ACCOUNT_OWNERSHIPS_FOUND</code></a></td><td>Emitted during a sync after a bank ownerships have been synchronized.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/products/data-aggregation/transactions-attachments#webhook"><code>TRANSACTION_ATTACHMENTS_FOUND</code></a></td><td>Emitted during a sync after bank accounts have been synchronized, and after the transactions are processed.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/products/documents-aggregation/subscriptions#subscription-synced"><code>SUBSCRIPTION_SYNCED</code></a></td><td>Emitted during a sync after a subscription was processed, including new documents.</td></tr><tr><td><a href="https://docs.powens.com/api-reference/products/documents-aggregation/subscriptions#subscription-found"><code>SUBSCRIPTION_FOUND</code></a></td><td>Emitted after a new subscription was discovered.</td></tr><tr><td><a href="/spaces/jaOZc6CNFstFU2WHDyoU/pages/ufnJNDcj3aJ7A5Ivp70w#payment-state-updated"><code>PAYMENT_STATE_UPDATED</code></a></td><td>Emitted after a payment has been updated.</td></tr></tbody></table>

If the user is still in a *temporary* state when the webhook events should be triggered (`USER_CREATED` for instance), the callback will be sent as soon as you make the user permanent.

Webhooks are triggered:

* after you ask for a specific action through the API and
* after a background synchronization (every 24h by default).

### Technical integration <a href="#technical-integration" id="technical-integration"></a>

#### Receiving the webhook data <a href="#receiving-the-webhook-data" id="receiving-the-webhook-data"></a>

By default, webhooks are performed using HTTP `POST` requests, with JSON body data.\
The `autosync.cfonb` config key is available to change the format of the `ACCOUNT_FOUND`, `CONNECTION_SYNCED` and `USER_SYNCED` callbacks to the CFONB format.

See the [full reference](/documentation/integration-guides/webhooks.md#available-webhook-events) above for the detailed format of each webhook. Alongside the event specific data in the request body, an additional `id_webhook_data` integer field is also included. It allows you to identify the webhook payload uniquely.

#### Expected response <a href="#expected-response" id="expected-response"></a>

Your server must respond with a 2XX (success) HTTP response code when a webhook is received on the provided URL, otherwise we consider that the webhook data has not been received.

If a webhook push failed, we will retry pushing that data until it is properly accepted.

#### Compression of webhook payload <a href="#compression-of-webhook-payload" id="compression-of-webhook-payload"></a>

During the first synchronization of a connection, your webhook will receive all the user's transactions and/or documents, which may produce a very large HTTP payload of *multiple MBs*. You can enable webhook compression to reduce the size of the exchanged content in the following cases:

* Your web server is configured to limit the HTTP body to a size that is not sufficient.
* You have more CPU resources than bandwidth.

When compression is activated, the HTTP body sent to your webhook will be compressed in gzip format and the HTTP header `content-encoding` will be set to `gzip`.

To activate webhook data compression, use the `webhooks.compression.enabled` [configuration key](https://docs.powens.com/api-reference/api-setup/configuration#get-configuration).

### Authentication <a href="#authentication" id="authentication"></a>

We support three alternative mechanisms to secure webhooks sent to your servers:

#### Authentication with user-scoped token <a href="#authentication-with-user-scoped-token" id="authentication-with-user-scoped-token"></a>

The default mechanism for webhooks authentication is perfomed by adding the user token in every callback request in the `Authorization` header:

```
Authorization: Bearer XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

When receiving a webhook, you can check that the provided token matches the record you have for the user, and reject the call otherwise.

{% hint style="warning" %} <mark style="color:orange;">This is only available for webhooks related to a specific user (e.g. not</mark> `PAYMENT_STATE_UPDATE`<mark style="color:orange;">).</mark>
{% endhint %}

#### Authentication with a HMAC signature header <a href="#authentication-with-a-hmac-signature-header" id="authentication-with-a-hmac-signature-header"></a>

An additional authentication method is available, which uses a hash-based message authentication code (HMAC). The code is generated with a shared secret, and authentication is performed by the client by recalculating the HMAC signature. This asserts that the sender of the webhook data knows the secret.

In order to enable it, you need to create a new `auth_provider` of type `hmac_signature`:

```json
POST /webhooks/auth
authorization: Bearer <yourConfigurationToken>

{
  "type": "hmac_signature",
  "name": "My HMAC provider",
}
```

```json
{
  "id": 2356,
  "type": "hmac_signature",
  "name": "My HMAC provider",
  "config": {
    "secret_key": <secret_key>
  }
}
```

The secret used to compute the HMAC signature can be found in the `config` object.

{% hint style="warning" %} <mark style="color:orange;">You should preserve this secret key safely as you will not be able to access it anymore after this.</mark>
{% endhint %}

See the "Association" section below for linking this newly created provider to your webhook(s).

The provider will add two headers to each webhook data:

* `BI-Signature-Date` containing a datetime in UTC ISO 8601 format generated during the request creation.
* `BI-Signature` = `BASE_64(HMAC_SHA256(<METHOD> + "." + <endpoint> + "." + <date> + "." + <payload>, secret_key))` where:
  * is the HTTP method used (POST), in capital letters;
  * is the listening URL endpoint of the client;
  * is the value contained in the `BI-Signature-Date` header;
  * is the webhook data payload.

Example calculation of a signature:

`BASE_64(HMAC_SHA256('POST./v1/webhook-listener.2022-06-27T11:08:52.577831Z.{"id": 1, "state": "done", ...}', secret_key))`

You can then reject any webhook data where the signature does not match your computation.

#### OAuth2 authentication <a href="#oauth2-authentication" id="oauth2-authentication"></a>

We also support securing webhooks using [OAuth 2.0](https://oauth.net/2/), the industry-standard protocol for authorization. When an OAuth 2.0 *provider configuration* is defined and associated with your wehbooks, callbacks will be secured with access tokens obtained from the authorization server and added to the `authorization` header.

The provided authorization server endpoint must fully support the [`client_credentials` grant type of the protocol](https://oauth.net/2/grant-types/client-credentials/):

* accept a standard payload with `client_id`, `client_secret` and `grant_type` (set to `client_credentials`);
* respond with a JSON entity with `access_token`, `token_type` (must be `Bearer`), and optionnally `expires_in` and `refresh_token` to implement tokens expiration;
* optionally, support a additional layer of security using a pair of certificates.

**Registration**

Configuration of auth providers will soon be available in the administration console. In the meantime, you can register them using the API.

You can use an API endpoint available on your domain to register a new provider. The call must be authenticated using your *configuration token*, available in the administration console. All parameters are mandatory, except from `public_cert` and `private_cert`.

```json
POST /webhooks/auth
authorization: Bearer <yourConfigurationToken>

{
  "type": "oauth",
  "name": "ACME provider",
  "config": {
    "url": "https://auth.example.org/token", // The full token endpoint URL of the provider
    "client_id": "123456", // Replace with your client ID
    "client_secret": "aJnr28jmdnIDNY9x11auihIX", // Replace with your client secret
    "grant_type": "client_credentials",
    "public_cert": "<yourPublicCert>", // Optional public certificate to use with the provider
    "private_cert": "<yourPrivateCert>" // Optional private certificate to use with the provider
  }
}
```

```json
{
  "id": 2356,
  "type": "oauth",
  "name": "ACME provider"
}
```

**Association**

When a provider has been created, you can associate it with a webhook in the administration console.

### Technical notes <a href="#technical-notes" id="technical-notes"></a>

#### Webhook vs. webhook data <a href="#webhook-vs-webhook-data" id="webhook-vs-webhook-data"></a>

It is important to distinguish a webhook from its data.

A webhook is a "registration" to a webhook event (USER\_CREATED, CONNECTION\_SYNCED, ...) including an URL that will receive the webhook data at event time.

A webhook request payload includes data associated with the webhook's event. For example, a webhook registered with the `USER_CREATED` event will include data with user information.

#### Webhook data flusher <a href="#webhook-data-flusher" id="webhook-data-flusher"></a>

Webhook requests are emitted immediately at creation (when the related event occurs). In case of failure, our webhook system uses a "flusher" retrying to send webhook data regularly. The flusher stops after 10 consecutive failures (or 2 timeouts) per webhook. In such case, it will attempt to send unprocessed webhook data at next execution.

An email can be sent when the flusher is failing. You must set the **biapi.manager.email** config key to receive it. In order to prevent email flooding, the config key **webhooks.alerts\_frequency** determines the minimum number of days between two emails per webhook (default: 1 = one day, can be 0.5 for twice a day). When the problem is solved, a flush recovery email is sent. See [configuration](https://docs.powens.com/api-reference/api-setup/configuration) reference to update configuration values.

You can monitor your webhook's health (average sending duration and sending success rate) through its `health_data` property. A warning is also displayed in a `warning` property if at least one of these values reaches a critical threshold.


