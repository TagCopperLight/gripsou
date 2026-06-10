# Users

## API endpoints

### Users management

## List users

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users`

List all users of the domain.

The endpoint requires [header authentication](/api-reference/overview/authentication.md) with a *users token*. \
The *users token* is only available in the *Settings* section of the [console](https://console.powens.com/).

{% tabs %}
{% tab title="200: OK List of users" %}
Response body: [Users](/api-reference/user-connections/users.md#userslist-object)
{% endtab %}
{% endtabs %}

## Get a user

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}`

Get a single user by ID.

The endpoint requires [header authentication](/api-reference/overview/authentication.md) with a *user token*

#### Path Parameters

| Name   | Type            | Description     |
| ------ | --------------- | --------------- |
| userId | Integer or "me" | ID of the user. |

{% tabs %}
{% tab title="200: OK User details" %}
Response body: [Users](/api-reference/user-connections/users.md#user-object)
{% endtab %}
{% endtabs %}

## Delete a user

<mark style="color:red;">`DELETE`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}`

Delete a user by ID.

The endpoint requires [header authentication](/api-reference/overview/authentication.md) with a *user token*

#### Path Parameters

| Name   | Type            | Description     |
| ------ | --------------- | --------------- |
| userId | Integer or "me" | ID of the user. |

{% tabs %}
{% tab title="204: No Content User deleted" %}

{% endtab %}
{% endtabs %}

## Webhooks

### User created <a href="#user-created" id="user-created"></a>

A `USER_CREATED` wehbook is emitted after a permanent user is created.

Webhook request: [#user-object](#user-object "mention")

### User deleted <a href="#user-deleted" id="user-deleted"></a>

A `USER_DELETED` wehbook is emitted after a user is deleted.

Webhook request: [#user-object](#user-object "mention")

### User synced (deprecated) <a href="#user-synced-deprecated" id="user-synced-deprecated"></a>

A `USER_SYNCED` webhook is emitted after multiple connections of a user have been synced. This webhook is deprecated for multiple connections per user, prefer usage of [`CONNECTION_SYNCED`](https://docs.budget-insight.com/reference/connections#connection-synced).

Webhook request:

<table><thead><tr><th width="185.33333333333331">Property</th><th>Type</th><th>Description</th></tr></thead><tbody><tr><td><code>user</code></td><td><a href="#user-object"><em>User</em></a> object</td><td>The user related to the sync.</td></tr><tr><td><code>connections</code></td><td>Array of <a href="/pages/5W80jLGBq7ifvqhRCiXo#connection-object"><em>Connection</em></a> objects</td><td>List of connections.</td></tr><tr><td><code>connections[].connector</code></td><td><a href="/pages/aEgj6uKNfjLxPdpZ831x#connector-object"><em>Connector</em></a> object</td><td>On each <code>connections</code> item, the connector associated with the connection.</td></tr><tr><td><code>connections[].sources</code></td><td>Array of <em>ConnectionSource</em> objects</td><td>On each <code>connections</code> item, the activated connections sources that were synced.</td></tr><tr><td><code>connections[].accounts</code></td><td>Array of <a href="/pages/6ZTi4nFvuqvWCMNrWCTt#get-a-bank-account"><em>BankAccount</em></a> objects</td><td>On each <code>connections</code> item, the activated bank accounts sources that were synced.</td></tr><tr><td><code>connections[].accounts[].transactions</code></td><td>Array of <a href="/pages/FmNMlfgHBosSWbMOIJjv#get-a-bank-transaction"><em>Transaction</em></a> objects</td><td>On each <code>accounts</code> item, the new transactions that were found.</td></tr></tbody></table>

## Data model

### *UsersList* object

<table><thead><tr><th width="191.33333333333331">Property</th><th width="187">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>users</code></td><td>Array of <a href="#user-object"><em>User</em></a> objects</td><td>List of users.</td></tr></tbody></table>

### *User* object

<table><thead><tr><th width="188.33333333333331">Property</th><th width="186">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>id</code></td><td>Integer</td><td>ID of the user.</td></tr><tr><td><code>signin</code></td><td>DateTime</td><td></td></tr></tbody></table>


