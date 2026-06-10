# Configuration

## API endpoints

{% hint style="success" %}
Authentication: endpoints listed in this page *require* [header authentication](/api-reference/overview/authentication.md) with a *config token*.\
The *config token* is only available in the *Settings* section of the [console](https://console.budget-insight.com/).
{% endhint %}

### Configuration management

## Get the domain configuration

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/config`

#### Query Parameters

| Name   | Type   | Description                                         |
| ------ | ------ | --------------------------------------------------- |
| search | String | Limit the results to keys matching the given value. |

{% tabs %}
{% tab title="200: OK Domain configuration" %}
Response body: Key-value object
{% endtab %}
{% endtabs %}

## Update the domain configuration

<mark style="color:green;">`POST`</mark> `https://{domain}.biapi.pro/2.0/config`

Request body: Key-value object

#### Query Parameters

| Name   | Type   | Description                                         |
| ------ | ------ | --------------------------------------------------- |
| search | String | Limit the results to keys matching the given value. |

{% tabs %}
{% tab title="200: OK Domain configuration updated" %}
Response body: Key-value object
{% endtab %}
{% endtabs %}

### Configuration logs

## Get the logs of configuration updates

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/config/logs`

#### Query Parameters

| Name      | Type   | Description                                         |
| --------- | ------ | --------------------------------------------------- |
| search    | String | Limit the results to keys matching the given value. |
| type      | String | Type of change done on the configuration.           |
| min\_date | Date   | Minimal date of the change.                         |
| max\_date | Date   | Maximal date of the change.                         |

{% tabs %}
{% tab title="200: OK Domain configuration" %}
Response body: Key-value object
{% endtab %}
{% endtabs %}

### Certificates management

## Get a certificate

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi/pro.2.0/certificate/{type}`

Get a certificate by type.

#### Path Parameters

| Name                                   | Type   | Description              |
| -------------------------------------- | ------ | ------------------------ |
| type<mark style="color:red;">\*</mark> | String | Type of the certificate. |

{% tabs %}
{% tab title="200: OK Certificate" %}
Response body: [#certificate-object](#certificate-object "mention")
{% endtab %}
{% endtabs %}

## Configuration keys <a href="#get-configuration" id="get-configuration"></a>

<table><thead><tr><th width="246">Configuration key</th><th width="98">Type</th><th width="88">Default</th><th>Description</th></tr></thead><tbody><tr><td><code>autosync.retry_wrongpass</code></td><td>Boolean</td><td>1</td><td>Allows to retry automatic synchronizations for connections in "wrongpass" error state. Second attempt occurs 12 hours later. Next attempts will then occur every 7 days.</td></tr><tr><td><code>biapi.allowed_origins</code></td><td>String</td><td>Empty string</td><td>Specifies authorized website domains when <a href="https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS">cross-origin</a> is needed (when using iframe on webpages for instance). Multiple origins can be defined, comma separated.</td></tr><tr><td><code>biapi.manager.email</code></td><td>String</td><td>Empty string</td><td>Sets the recipient email address of the webhook error emails.</td></tr><tr><td><code>connectors.default_auth_mechanism</code></td><td>String</td><td>Empty string</td><td>Defines the auth_mechanism to be used if not already defined for the source or its related connector. Accepted values are <code>webauth</code> and <code>credentials</code>.</td></tr><tr><td><code>connectors.enable_new</code></td><td>Boolean</td><td>0</td><td>Enables new connectors by default as soon as they are deployed.</td></tr><tr><td><code>connectors.sources.enable_new</code></td><td>Boolean</td><td>1</td><td>Enables new sources on connectors. If not, new sources are disabled by default.</td></tr><tr><td><code>oauth2.enabled</code></td><td>Boolean</td><td>1</td><td>Enables <a href="https://en.wikipedia.org/wiki/OAuth">OAuth2 protocol</a>.</td></tr><tr><td><code>webhooks.alerts_frequency</code></td><td>Decimal</td><td>1</td><td>Defines the frequency of webhooks alerts, in days.</td></tr><tr><td><code>webhooks.compressions.enabled</code></td><td>Boolean</td><td>0</td><td>Enables the compression of the HTTP body of your webhook into gzip format.</td></tr><tr><td><code>payment.max_amount</code></td><td>Decimal</td><td>0</td><td>Defines a maximum authorized amount for pay transactions. 0 is considered as if the value was not set. There is no maximum.</td></tr></tbody></table>

## **Data model**

### ***Certificate*****&#x20;object**

<table><thead><tr><th width="259">Property</th><th width="133.33333333333331">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>id</code></td><td>Integer</td><td>ID of the certificate.</td></tr><tr><td><code>type</code></td><td>String</td><td>The type of certificate.</td></tr><tr><td><code>id_public_key_file</code></td><td>Integer</td><td></td></tr><tr><td><code>id_private_key_file</code></td><td>Integer</td><td></td></tr><tr><td><code>created</code></td><td>DateTime</td><td></td></tr></tbody></table>


