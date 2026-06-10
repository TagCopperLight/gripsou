# API Overview

### Overview <a href="#overview" id="overview"></a>

Our API is a REST API which requires a communication through HTTPS to send and receive JSON documents. During your tests, we recommend to make calls to the API with curl or any other HTTP client of your choice.

### Hello world <a href="#hello-world" id="hello-world"></a>

Let's start by calling the service /connectors which lists all available banks/providers.

```bash
curl https://{domain}.biapi.pro/2.0/connectors/
```

To log in to a bank/provider webpage, you'll need to know for a given connector, the fields your user should fill in the form. Let's call a specific connector and ask for an additional resource fields.

```bash
curl https://{domain}.biapi.pro/2.0/connectors/59?expand=fields
```

The response here concerns only 1 connector (since we specified an id) and the resource `fields` is added to the response thanks to the query parameter `expand`.

To get more interesting things done, you'll need to send authenticated requests.

### Authentication <a href="#authentication" id="authentication"></a>

The way to authenticate is by passing the `authorization: Bearer <token>` header in your request. At the setup several manage tokens have been generated with the different scopes (categorization, config, invoicing and user). You can use one of these tokens for now, when creating your user we'll see how to generate a user's token.

```bash
curl https://{domain}.biapi.pro/2.0/config \
  -H 'authorization: Bearer <token>'
```

This endpoint will list all the parameters you can change to adapt our API to your needs.

We've covered the very first calls. Before diving deeper, let's see some general information about APIs.

### Abstract <a href="#abstract" id="abstract"></a>

#### API URL <a href="#api-url" id="api-url"></a>

```
https://{domain}.biapi.pro/2.0
```

#### Requests format <a href="#requests-format" id="requests-format"></a>

Data format: `application/x-www-form-urlencoded` or `application/json` (suggested)

Additional headers: `authorization`: User's token (private)

#### Responses format <a href="#responses-format" id="responses-format"></a>

Data format: `application/json` ([http://www.json.org](http://www.json.org/)) Charset: UTF-8

#### Resources <a href="#resources" id="resources"></a>

Each call on an endpoint will return resources. The main resources are:

<table><thead><tr><th width="190">Resources</th><th>Description</th></tr></thead><tbody><tr><td>Accounts</td><td>A bank account contained in a connection</td></tr><tr><td>Connections</td><td>A set of data used to authenticate on a website (usually a login and password). There is 1 connection for each website.</td></tr><tr><td>Documents</td><td>A document in a bank account or a provider subscription</td></tr><tr><td>Investments</td><td>An asset in a bank account</td></tr><tr><td>Subscriptions</td><td>A provider subscription contained in a connection (Trust only)</td></tr><tr><td>Transactions</td><td>An entry in a bank account</td></tr><tr><td>Users</td><td>Represent a user</td></tr></tbody></table>


