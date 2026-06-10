# Glossary

#### Client application <a href="#client-application" id="client-application"></a>

A client application identifies a caller requesting your Powens API. One client application is required at least per API. The definition of a client application lets you configure the associated [Webview](https://docs.powens.com/api-reference/overview/webview), a ready-to-use web interface to add connections to your domain. You can configure multiple client applications if you wish to propose webviews with different settings.

#### Connection <a href="#connection" id="connection"></a>

A [connection](https://docs.powens.com/api-reference/user-connections/connections) materializes the link between an end user and one of the connector we support. Adding a connection requires the end user to authenticate on the connector. As long as the credentials stay valid, we take care of synchronizing user data. Product data are available through connections.

#### Connector <a href="#connector" id="connector"></a>

In our system, the [connector](https://docs.powens.com/api-reference/user-connections/connectors) represents the institution with which we establish a connection to retrieve end user data (bank accounts, transactions, billing contracts, documents…).

#### Credentials <a href="#credentials" id="credentials"></a>

Credentials generally represents end user identifiers (login, password or other key fields). In the context of connections in Powens API, "credentials" is also the name we use for a specific authentication mechanism where the end user is filling a form with his identifiers in order to establish the connection with the institution. In this case, we store the credentials in an encrypted and secured device.

#### Direct Access <a href="#direct-access" id="direct-access"></a>

`directaccess` is one of the [connector source types](https://docs.powens.com/api-reference/user-connections/connectors#list-connectors) representing the website of the institution from which we directly read the information.

#### Fallback <a href="#fallback" id="fallback"></a>

`fallback` is one of the  [connector source types](https://docs.powens.com/api-reference/user-connections/connectors#list-connectors) representing the emergency gateway provided by banks regarding of the PSD2 when their API is down.

#### Open API <a href="#open-api" id="open-api"></a>

`openapi` is one of the [connector source types](https://docs.powens.com/api-reference/user-connections/connectors#list-connectors) representing an API provided by the institution to get data (i.e. PSD2 API for European banks).

#### PSU <a href="#psu" id="psu"></a>

Payment Service User, the end-user of payment services.

#### Source <a href="#source" id="source"></a>

In order to access institution information (bank accounts, transactions, billing contracts, documents…), we can use various channels. The channel allows us to establish a connection with the institution, it is called a [connector source](https://docs.powens.com/api-reference/user-connections/connectors#list-connectors). We currently handle three types of source: `openapi`, `fallback` and `directaccess`.

#### Subscription <a href="#subscription" id="subscription"></a>

A subscription is a representation of a bill contract or group of documents. It is a parallel representation of accounts on the bank system.

#### Webauth <a href="#webauth" id="webauth"></a>

"webauth" is the name we use for a specific authentication mechanism where the end user is redirected to the app or website owned by the institution on which he wants to connect. In this case, we do not store end user credentials, the login process is handled by the institution that just confirms or denies the authentication and calls us back.


