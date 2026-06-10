# Add a first user and connection

## Add a first user and connection <a href="#add-a-first-user-and-connection" id="add-a-first-user-and-connection"></a>

{% hint style="info" %}
If you want to initiate payments, you do not need to add user/connection, please refer to the [pay guide](broken://pages/Xc77IG4DjS9kUvaAdxOW).
{% endhint %}

### Prerequisites <a href="#prerequisites" id="prerequisites"></a>

To start interacting with our API, make sure you have setup a domain and a client application in the administration console.

### Users and connections <a href="#users-and-connections" id="users-and-connections"></a>

#### User scope <a href="#user-scope" id="user-scope"></a>

Users of your application exist in our API. All data collected and exposed through our services is organized and scoped by *users*. We enforce isolated access to user data by issuing *user-scoped access tokens*, shared secrets that let you both authorize with our API and identify the relevant user you want to interact with.

{% hint style="warning" %} <mark style="color:orange;">You are responsible for keeping these tokens safe, and maintain the association with your own user registry.</mark>
{% endhint %}

#### Connections <a href="#connections" id="connections"></a>

User data arise from *connections*. A connection materializes the link between a *user* and one of the *connectors* (banks or billing providers) we support. Creating a connection requires the end-user to authenticate with the connector. As long as the connection is active, we take care of synchronizing user data and expose it.

{% @mermaid/diagram content="graph LR
usr\["User"] --- ctn1\["Connection #1"] & ctn2\["Connection #2"] --- ctrA\["Connector A"]
usr --- ctn3\["Connection #3"] --- ctrB\["Connector B"]" %}

You will need to let your users add a first connection before you can access its banking or billing data.

### Adding a new connection <a href="#adding-a-new-connection" id="adding-a-new-connection"></a>

{% hint style="info" %}
You can use our [integration demo](https://integrate.powens.com/demos/connect) to experiment with the different steps described below.
{% endhint %}

The simplest way to perform a connection setup is to use our [Connect webview](https://docs.powens.com/api-reference/overview/webview#add-connection-flow), a set of web-based endpoints that complement your domain API. It will take care of letting the user choose his bank or provider, gather credentials for later sync and manage consent to the individual bank accounts or document subscriptions he wants to share with your service, enforcing GDPR requirements.

The steps include:

* generating a permanent user access token;
* before opening the Webview, generating a temporary code from the permanent user access token;
* redirecting the user to the Webview, providing the temporary code as parameter, to let him pick up a *connector* and add a *connection*;
* handling redirection after the web steps.

{% @mermaid/diagram content="  sequenceDiagram
participant Your app/service
participant Our Webview
Your app/service ->> Our API: Generate permanent user access token
Your app/service ->> Your app/service: Save access token
Your app/service ->> Our API: Generate temporary code
Your app/service ->> Our Webview: Present in browser
Our Webview -->> Our API: Add a connection
Your app/service ->> Our API: Access data
" %}

You need to generate a permanent user access token for your new user which will create a new user on Powens side:

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

{% hint style="warning" %} <mark style="color:orange;">This step involves sending your client secret (a sensitive data), you must perform it from a secure environment.</mark>
{% endhint %}

Then before redirecting to the Webview generate a temporary code that you will provide to the Webview URL. This is so you're not opening the Webview using the permanent access token directly.&#x20;

```
GET https://{domain}.biapi.pro/2.0/auth/token/code
```

Authenticate this request using the permanent access token you previously generated.&#x20;

```json
{
  "code": "{temporaryCode}",
  …
}
```

For the most simple configuration, present the following URL to your user (new lines are only added for clarity):

```
https://webview.powens.com/connect
  ?domain={domain}
  &client_id={clientId}
  &redirect_uri={yourCallbackUri}
  &code={temporaryCode}
```

You will need to provide the `client_id` of the client application created in the administration console, and a `redirect_uri` to use as a callback that must match the white-list defined in the console.

{% hint style="info" %}
To optimize user experience, we encourage you to open the webview in a standalone fully-capable browser following [our best practices](https://docs.powens.com/api-reference/overview/webview#implementation-guidelines). The webview appearance can be customized in the Administration console, and its behavior can be configured using [additionnal parameters](https://docs.powens.com/api-reference/overview/webview#endpoints-reference).
{% endhint %}

After the user has completed all steps in the webview, he will be redirected to your callback URL:

```
{yourCallbackUri}?connection_id={id}
```

The connection flow can also lead to errors, reported with the `error` and `error_description` parameters, your implementation must [handle them gracefully](https://docs.powens.com/api-reference/overview/webview#implementation-guidelines).

If eligible, you can [build your custom connection implementation](/documentation/integration-guides/advanced/custom-connection-implementation.md) instead of using our webview.

### Use the access token <a href="#use-the-access-token" id="use-the-access-token"></a>

Congratulations, you have been provided an access token that you must save, and that you can use to interact with all our products!

As soon as a connection is created, it gets synchronized (in background). If you have configured [webhooks](/documentation/integration-guides/webhooks.md), data will be pushed as soon as the synchronization complete.

{% hint style="info" %}
After creation, you should provide your users a way to manage their connections (add/delete, or manage consent to accounts). You can use our [Manage webview](https://docs.powens.com/api-reference/overview/webview#manage-connections) for this or create your own implementation. Also, you need to properly [handle the various connection states](/documentation/integration-guides/sca-and-connection-states.md) that may occur afterwards.
{% endhint %}


