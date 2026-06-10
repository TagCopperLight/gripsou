# Client applications

## Create a client application

<mark style="color:green;">`POST`</mark> `https://{domain}.biapi.pro/2.0/clients`

Request body: [#clientapprequest-object](#clientapprequest-object "mention")

{% tabs %}
{% tab title="201: Created Client application created" %}
Response body: [#clientapp-object](#clientapp-object "mention")
{% endtab %}
{% endtabs %}

## List client applications

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/clients`

{% tabs %}
{% tab title="200: OK List of client applications" %}
Response body: [#clientappslist-object](#clientappslist-object "mention")
{% endtab %}
{% endtabs %}

## Get a client application

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/clients/{clientAppId}`

Get a single client application by ID.

#### Path Parameters

| Name                                          | Type    | Description                   |
| --------------------------------------------- | ------- | ----------------------------- |
| clientAppId<mark style="color:red;">\*</mark> | Integer | ID of the client application. |

{% tabs %}
{% tab title="200: OK Client application" %}
Response body: [#clientapp-object](#clientapp-object "mention")
{% endtab %}
{% endtabs %}

## Update a client application

<mark style="color:orange;">`PUT`</mark> `https://{domain}.biapi.pro/2.0/clients/{clientAppId}`

Update a single client application by ID.

Request body: [#update-a-client-application-1](#update-a-client-application-1 "mention")

#### Path Parameters

| Name                                          | Type    | Description                   |
| --------------------------------------------- | ------- | ----------------------------- |
| clientAppId<mark style="color:red;">\*</mark> | Integer | ID of the client application. |

{% tabs %}
{% tab title="200: OK Client application updated" %}
Response body: [#clientapp-object](#clientapp-object "mention")
{% endtab %}
{% endtabs %}

## Delete a client application

<mark style="color:red;">`DELETE`</mark> `https://{domain}.biapi.pro/2.0/clients/{clientAppId}`

Delete a client application by ID.

#### Path Parameters

| Name                                          | Type    | Description                   |
| --------------------------------------------- | ------- | ----------------------------- |
| clientAppId<mark style="color:red;">\*</mark> | Integer | ID of the client application. |

{% tabs %}
{% tab title="204: No Content Client application deleted" %}

{% endtab %}
{% endtabs %}

## Update the logo of a client application

<mark style="color:green;">`POST`</mark> `https://{domain}.biapi.pro/2.0/clients/{clientAppId}/logo`

#### Path Parameters

| Name                                          | Type    | Description                   |
| --------------------------------------------- | ------- | ----------------------------- |
| clientAppId<mark style="color:red;">\*</mark> | Integer | ID of the client application. |

## Data model <a href="#create-a-client-application" id="create-a-client-application"></a>

### ***ClientAppRequest*****&#x20;object**

<table><thead><tr><th width="182">Property</th><th width="110">Type</th><th width="107">Required</th><th>Description</th></tr></thead><tbody><tr><td><code>generate_keys</code></td><td>Boolean</td><td>No</td><td>If true, generate a RSA pair of keys so the client can be used to generate JWT user tokens. The default is false.</td></tr><tr><td><code>name</code></td><td>String</td><td>No</td><td>Name of the client app.</td></tr><tr><td><code>redirect_uris</code></td><td>String</td><td>No</td><td>List of allowed redirect URIs.</td></tr><tr><td><code>config</code></td><td>String</td><td>No</td><td>Custom config about the client.</td></tr></tbody></table>

### ***ClientAppsList*****&#x20;object**

<table><thead><tr><th width="202.33333333333331">Property</th><th width="233">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>clients</code></td><td>Array of <a href="#clientapp-object"><em>ClientApp</em></a> objects</td><td>The client applications.</td></tr></tbody></table>

### ***ClientApp*****&#x20;object**

<table><thead><tr><th width="185.33333333333331">Property</th><th width="162">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>id</code></td><td>Integer</td><td>ID of the client.</td></tr><tr><td><code>name</code></td><td>String</td><td>Name of the client application.</td></tr><tr><td><code>secret</code></td><td>String or null</td><td>The client secret is only exposed if you use a manage or configuration token.</td></tr><tr><td><code>public_key</code></td><td>String or null</td><td></td></tr><tr><td><code>private_key</code></td><td>String or null</td><td></td></tr><tr><td><code>redirect_uris</code></td><td>String</td><td></td></tr><tr><td><code>id_logo</code></td><td>Integer or null</td><td></td></tr><tr><td><code>config</code></td><td>String</td><td>Customizable config.</td></tr></tbody></table>

### ***ClientAppUpdateRequest*****&#x20;object** <a href="#update-a-client-application" id="update-a-client-application"></a>

<table><thead><tr><th width="185">Property</th><th width="101">Type</th><th width="102">Required</th><th>Description</th></tr></thead><tbody><tr><td><code>generate_keys</code></td><td>Boolean</td><td>No</td><td>If true, generate a RSA pair of keys so the client can be used to generate JWT user tokens. The key has no effect if the client already has a set of keys. The default is false.</td></tr><tr><td><code>name</code></td><td>String</td><td>No</td><td>New name of the client app.</td></tr><tr><td><code>secret</code></td><td>String</td><td>No</td><td>Reset the secret of the client.</td></tr><tr><td><code>redirect_uris</code></td><td>String</td><td>No</td><td>New list of allowed redirect URIs.</td></tr><tr><td><code>primary_color</code></td><td>String</td><td>No</td><td>Hexadecimal code of the client primary color</td></tr><tr><td><code>config</code></td><td></td><td>No</td><td>Custom config about the client</td></tr><tr><td><code>update_config</code></td><td>Boolean</td><td>No</td><td>Merge the provided <code>config</code> with the existing one instead of replacing. The default is true.</td></tr></tbody></table>


