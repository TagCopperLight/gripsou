# Custom connection implementation

{% hint style="warning" %} <mark style="color:orange;">Building a full custom implementation of the connection protocol is only available to integrators holding the Agent Status as defined in article</mark> [L523-1](https://www.legifrance.gouv.fr/affichCodeArticle.do?idArticle=LEGIARTI000035430788\&cidTexte=LEGITEXT000006072026\&dateTexte=20200618) <mark style="color:orange;">of Code Monétaire et Financier (CMF). Please validate the integration with your account manager before proceeding. This option requires a significant amount of work and testing. We advise to rely on our</mark> [Connect webview](https://docs.powens.com/api-reference/overview/webview#add-connection-flow) <mark style="color:orange;">unless necessary.</mark>
{% endhint %}

### UX guidelines <a href="#ux-guidelines" id="ux-guidelines"></a>

The following diagram illustrates the general recommended UX for adding a connection, see below for the detail of the different steps:

<figure><img src="/files/oNik642thnVUN6UcwdyS" alt=""><figcaption></figcaption></figure>

### Bank and Wealth implementation <a href="#bank-and-wealth-implementation" id="bank-and-wealth-implementation"></a>

For technical and regulatory reasons, bank connectors require a richer UX with multiple authentication steps as soon as your use-case involves gathering multiple account types (payment and non-payment). We recommend to present these steps sequentially and to follow these best practices:

#### Option 1: Present additional accounts as an option (recommended) <a href="#option-1-present-additional-accounts-as-an-option-recommended" id="option-1-present-additional-accounts-as-an-option-recommended"></a>

If your use case can work with a partial list of the user accounts, we recommend to present the aggregation of additional account types as an option on the activation screen:

<figure><img src="/files/VACEebqLYCKbewjrfsFP" alt=""><figcaption></figcaption></figure>

#### Option 2: Restrict aggregation to required accounts only <a href="#option-2-restrict-aggregation-to-required-accounts-only" id="option-2-restrict-aggregation-to-required-accounts-only"></a>

If your use-case only requires either payment or non-payment accounts, you should limit the connection flow to only the required account types:

<figure><img src="/files/cDYyqkPT2my2VRJtTtaq" alt=""><figcaption></figcaption></figure>

#### Option 3: Force chaining of authentication flows <a href="#option-3-force-chaining-of-authentication-flows" id="option-3-force-chaining-of-authentication-flows"></a>

If you always need to get **all** accounts for a given user (payment and non-payment accounts), chain the authentication steps:

<figure><img src="/files/JdPYecNwtRILLkjBHhuS" alt=""><figcaption></figcaption></figure>

### Technical steps <a href="#technical-steps" id="technical-steps"></a>

The full protocol of connection addition involves the following steps:

* obtain a user context by creating a temporary user resource, or using an existing token;
* if applicable, let the user select the target connector, and optionally the specific connector source (bank connectors only);
* follow the appropriate authentication mechanism for the selected connector or source, either redirecting the user to a third-party webview, or presenting to the user a form with a set of credentials fields;
* handle connection creation with potential multiple steps (e.g. multifactor authentication);
* get user consent and activate individual access to bank accounts and subscriptions;
* for bank connections, repeat these steps for all available connector sources.

{% @mermaid/diagram content="graph TB
newUser("Create a user<br>`POST /auth/init`") --> getConnectors
reuseToken("Use an existing token") --> getConnectors
getConnectors("List connectors<br>`GET /connectors`") --> presentConnectors("User chooses a connector") --> connectorMechanism{"Connector<br>`auth_mechanism`<br>?"}
connectorMechanism -->|"`webauth`"| getWebauthFields("Show `webauth` fields if any<br>`GET /fields`") --> webauthCode("Get auth code<br>`GET /auth/token/code`") --> webauthOpen("Open browser<br>`/webauth?#hellip;`") --> webauthRedirect("Redirection to<br>`callback_uri`"<br>with `state` param) --> handleState
connectorMechanism -->|"`credentials`"| getFields("Show fields<br>`GET /fields`") --> fieldsForm("User completes form") --> fieldsPost("Submit values<br>`POST /connections`") --> handleState
handleState("[Handle connection state](https://docs.powens.com/documentation/integration-guides/advanced/guides/handle-scas-connection-states)")
" %}

### User context <a href="#user-context" id="user-context"></a>

Connection addition is performed in the context of an authenticated user in our API. You must obtain a user-scoped access token to interact with our API.

For a new user, you can create a new access token in the API using the dedicated [`/auth/init`](https://docs.budget-insight.com/reference/authentication#create-an-anonymous-user) endpoint:

```
POST https://{domain}.biapi.pro/2.0/auth/init
```

```json
{
  "client_id": "{clientId}",
  "client_secret": "{clientSecret}"
} 
```

```json
{
  "auth_token": "{accessToken}",
  …
}
```

Once obtained, this access token represents the newly created user. You have to store it and reuse it to subsequently add new connections to this user or query the associated data.

### Connector selection <a href="#connector-selection" id="connector-selection"></a>

<figure><img src="https://docs.budget-insight.com/assets/img/connection-flow-1.png" alt=""><figcaption></figcaption></figure>

If applicable for your use case, you may present to the user a list of supported connectors to pick from. You can obtain the list from the [`/connectors`](https://docs.budget-insight.com/reference/connectors##list-connectors) endpoint:

```
GET https://{domain}.biapi.pro/2.0/connectors
```

```json
{
  "connectors": [
    {
      "id": 40,
      "name": "Connecteur de test",
      "auth_mechanism": "credentials",
      "capabilities": [ "bank", "document", "profile", … ],
      …
    },
    …
  ]
}
```

{% hint style="info" %} <mark style="color:blue;">As we may add or modify connectors frequently, we do not recommend using a static cache of connectors. Instead, always get the current available list when adding a new connection.</mark>\ <mark style="color:blue;">You can manage the connectors available on your domain in the administration console.</mark>
{% endhint %}

You can filter the connectors list according to your needs, e.g. rely on the supported `capabilities`.

#### Source refinement <a href="#source-refinement" id="source-refinement"></a>

For bank connectors, we provide a mechanism to aggregate subsets of a user bank accounts through the addition of connector *sources*. Connectors providing both payment and non-payment accounts will usually present two or more *sources*. You can access the sources of a connector and their properties by expanding the previous call:

```
GET https://{domain}.biapi.pro/2.0/connectors?expand=sources
```

```json
{
  "connectors": [
    {
      "id": 40,
      "name": "Connecteur de test",
      "sources": [
        { "name": "directaccess", "priority": 1, "auth_mechanism": "credentials", "capabilities": [ … ], … },
        { "name": "openapi", "priority": 2, "auth_mechanism": "webauth", "capabilities": [ … ], … }
      ]
    },
    …
  ]
}
```

{% hint style="warning" %} <mark style="color:orange;">Adding sources to a connection separately and sequentially is required when integrating banking connectors. Failing to specify a source when adding a connection to a connector will result in a single source being available, hence with partial access to the end-accounts. Depending on your use-case, you can filter the sources to add using the</mark> `account_types` <mark style="color:orange;">and</mark> `capabilities` <mark style="color:orange;">attribute.</mark>
{% endhint %}

Make sure the `disabled` property of a source is null before interacting with it (sources can be (de)activated in your administration console). Also, the `priority` order of sources must be honored when adding them sequentially: add the source with the *lowest* `priority` value first.

Once a source has been added, you usually give the user the choice of selecting the accounts to synchronize or adding further accounts for the chosen connector. It is also possible to not let them add another source right away, or at all. For example, if you are only interested in payment accounts, we strongly recommend that you only offer to add the only source that provides these account types.

### Add the connection or source <a href="#add-the-connection-or-source" id="add-the-connection-or-source"></a>

The required flow varies depending on the `auth_mechanism` of the selected connector or source.

#### Credentials connector/source <a href="#credentials-connectorsource" id="credentials-connectorsource"></a>

The `credentials` mechanism involves presenting a form with a set of fields and posting the values to the API to create the connection.

<figure><img src="https://docs.budget-insight.com/assets/img/connection-flow-2a.png" alt=""><figcaption></figcaption></figure>

First, [determine the fields](https://docs.powens.com/api-reference/user-connections/connectors#connectorfield-object) that you must present to the user. You can obtain them by expanding the list of connectors call above (`?expand=fields`), or perform a dedicated call:

```
GET https://{domain}.biapi.pro/2.0/connectors/{connectorId}/fields
```

```json
{
  "fields": [
    {
      "name": "login",
      "label": "Identifiant",
      "type": "text",
      "required": true,
      "connector_sources": [ "directaccess" ]
    },
    {
      "name": "password",
      "label": "Mot de passe",
      "type": "password",
      "required": true,
      "connector_sources": [ "directaccess" ]
    },
    …
  ]
}
```

If you are adding a single source to the connector, you should filter out the fields that do not match the name of the source. When adding a secondary source in a sequential experience, you should also filter out fields that are associated with sources already added, as the value is not required.

You should build and present a UI that handles all the possible configurations of form fields. We recommend that you present the `label` and `description` texts with the input control, and that you pre-validate the input using the `required` and `regex` properties.

When the user validates the form, send the chosen connector ID (optionally with the source) and the field values to the [creation endpoint](https://docs.powens.com/api-reference/user-connections/connections):

```
POST https://{domain}.biapi.pro/2.0/users/me/connections?source=openapi
```

```json
{
  "id_connector": 4,
  "login": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
  "password": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
}
```

```json
{
  "id": 123,
  "state": null,
  …
}
```

{% hint style="warning" %} <mark style="color:orange;">All the field values must be</mark> [end-to-end encrypted](/documentation/integration-guides/advanced/end-to-end-encryption.md) <mark style="color:orange;">when sent to the API.</mark>
{% endhint %}

The above call will result in the creation of a new connection, returned in the response. As credentials are *synchronously* checked during this step, handle the HTTP connection appropriately to avoid timeouts. When adding additional sources to an existing connection, use the same request on the [update endpoint instead](https://docs.powens.com/api-reference/user-connections/connections#update-a-connection).

{% hint style="info" %} <mark style="color:blue;">Connections or sources created with invalid credentials (refused by the establishment) are deleted at once. A new connection has to be created in that case when re-validating the form. Make sure you also handle the</mark> <mark style="color:blue;"></mark><mark style="color:blue;">`wrongpass`</mark> <mark style="color:blue;"></mark><mark style="color:blue;">error code that can be raised on posting the credentials.</mark>
{% endhint %}

#### Webauth connector/source <a href="#webauth-connectorsource" id="webauth-connectorsource"></a>

The `webauth` mechanism involves delegating the authorization to a webview that should be presented to the end-user in a browser.

<figure><img src="https://docs.budget-insight.com/assets/img/connection-flow-2b-3b.png" alt=""><figcaption></figcaption></figure>

First, as with the `credentials` mechanism, determine the fields that you must present for the chosen connector. Check for any field whose `auth_mechanisms` include `webauth`:

```
GET https://{domain}.biapi.pro/2.0/connectors/{connectorId}/fields
```

```json
{
  "fields": [
    {
      "auth_mechanisms": [ "webauth" ],
      "name": "website",
      "label": "Type de compte",
      "type": "list",
      "values": [ … ]
    },
    …
  ]
}
```

When adding a secondary source in a sequential experience, you should filter out fields that are associated with sources already added, as the value is not required.

Once the user validates the form if any, [obtain a temporary code](https://docs.powens.com/api-reference/overview/authentication#generate-a-temporary-code) linked to your token to secure the connection addition:

```
GET https://{domain}.biapi.pro/2.0/auth/token/code
```

```json
{ "code": "xxxxxx", … }
```

Then, open the [webauth endpoint](https://docs.powens.com/api-reference/user-connections/connections#redirect-to-a-url-for-web-authorization) in a browser and specify the connector ID and source:

```
https://{domain}.biapi.pro/2.0/webauth
  ?client_id={clientId}
  &token={temporaryCode}
  &id_connector={connectorId}
  &source={optionalSource}
  &redirect_uri={yourCallbackUri}
```

In the case there were presented fields, submit their values along with these parameters.

The `redirect_uri` that you provide here is required to match the configuration set in the administration console.

After authorization has been granted by the user in the webview, you will be redirected to the provided `redirect_uri`, with additional parameters added in the query:

```
{yourCallbackUri}
  ?id_connection=123
  &state=null
```

### Resume connection state <a href="#resume-connection-state" id="resume-connection-state"></a>

Immediately after the connection or source is created, we may need additional information or an SCA to perform the first synchronization of the connection. According to the `state` of the connection or the source (either obtained in the API response or as a parameter of the redirect URI), you must take the steps described in [the guide dedicated to connection state handling](/documentation/integration-guides/sca-and-connection-states.md).

<figure><img src="https://docs.budget-insight.com/assets/img/connection-flow-3a.png" alt=""><figcaption></figcaption></figure>

### Activate bank accounts and subscriptions <a href="#activate-bank-accounts-and-subscriptions" id="activate-bank-accounts-and-subscriptions"></a>

After a new connection or source is added and synced, new bank accounts and subscriptions are discovered and made available in the API.\
However, due to GDPR enforcement, full synchronization is not enabled on these resources as an explicit and dedicated end-user approval is required. By default, they are flagged with the `disabled` property.

<figure><img src="https://docs.budget-insight.com/assets/img/connection-flow-4.png" alt=""><figcaption></figcaption></figure>

You may [list the accounts](https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts#list-bank-accounts)/[subscriptions](https://docs.powens.com/api-reference/products/documents-aggregation/subscriptions) and prompt the end-user for activating them:

```
GET https://{domain}.biapi.pro/2.0/users/me/connections/{connectionId}/accounts?all
```

```json
{
  "accounts": [
    { "id": 1234, "name": "Current account", "disabled": "2020-06-01 12:34:56", … },
    { "id": 4567, "name": "Saving account", "disabled": "2020-06-01 12:34:56", … },
    …
  ]
}
```

{% hint style="info" %} <mark style="color:blue;">You can also use the</mark> `expand=all_accounts,all_subscriptions` <mark style="color:blue;">feature on a connection to get the activable resources at once.</mark>
{% endhint %}

Once desired sources have been added, and the user has selected the appropriate accounts/subscriptions, you can active the accounts/subscriptions to enable the synchronization of their transactions and documents:

```
PUT https://{domain}.biapi.pro/2.0/users/me/connections/{connectionId}/accounts/1234,4567?all
```

```json
{ "disabled": false }
```

{% hint style="info" %}
The UI to activate bank accounts or subscriptions is the recommended place to perform sequential addition of optional sources. First, let the user add the first source only using the above steps. Then, on listing the available accounts, you can propose an option to add more accounts by adding the next source if available (enabling accounts must be done in one call after the addition of the sources):
{% endhint %}

<figure><img src="https://docs.budget-insight.com/assets/img/connection-flow-4-alt.png" alt=""><figcaption></figcaption></figure>

### Persist the created user <a href="#persist-the-created-user" id="persist-the-created-user"></a>

If you created a temporary user on initializing the process, you must eventually [convert your temporary token](https://docs.powens.com/api-reference/overview/authentication#exchange-a-temporary-code-for-a-permanent-user-access-token) to a permanent access token. You may store this new token to access data of the user:

```
POST https://{domain}.biapi.pro/2.0/auth/token/access
```

```json
{
  "grant_type": "authorization_code",
  "client_id": "{clientId}",
  "client_secret": "{clientSecret}",
  "code": "{temporaryAccessToken}"
}
```

```json
{
  "token": "{longLivedAccessToken}"
}
```


