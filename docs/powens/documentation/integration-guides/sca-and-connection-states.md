# SCA & connection states

### Connection synchronization <a href="#connection-sync" id="connection-sync"></a>

Retrieving user data from the connectors happens in an asynchronous way. Synchronization of a connection is performed:

* right after the connection is created, or has its credentials updated;
* automatically at regular intervals;
* optionally on an explicit API request.

In either case, the sync process will upgrade the available dataset of the user if everything goes smoothly. But the process can also fail in various situations:

* the website or the API of the target connector is unavailable;
* the user needs to renew his consent or grant a supplementary explicit access for the synchronization to proceed (e.g. strong customer authentication);
* the provided credentials are invalid and need to be updated;
* we encounter a temporary error, as interfacing with constantly-evolving APIs or websites can be tough ;-)...

{% hint style="info" %}
Synchronization statuses are available by connector in the Monitoring page of your domain, in the [administration console](https://console.budget-insight.com/).
{% endhint %}

#### Connection states <a href="#connection-states" id="connection-states"></a>

When synchronization fails, we update the [`state` property of the *connection* resource](https://docs.powens.com/api-reference/user-connections/connections#get-a-connection) with an error code that reflects the situation. As an integrator, you should handle this state and guide the user into recovering from the situation.

<table><thead><tr><th width="320">Connection state</th><th>Actions to take</th></tr></thead><tbody><tr><td>(null)</td><td>The synchronization was successful, no error.</td></tr><tr><td><code>SCARequired</code><br><code>webauthRequired</code><br><code>additionalInformationNeeded</code><br><code>decoupled</code><br><code>validating</code> (transcient)</td><td>Synchronization is suspended because we need user consent or SCA to proceed. You should <strong>present this error prominently</strong> with <a href="/pages/tbMWC02KvpMXPeJTOa1g#resumerecover-connection-sync">an option to resume the connection using the indications below</a>.</td></tr><tr><td><code>actionNeeded</code></td><td>Synchronization failed because the user needs to perform an action directly on the bank website or app (usually, accept new CGUs or similar one-time actions). You should <strong>present this error prominently</strong>, with the details in the <code>error_message</code> property.</td></tr><tr><td><code>passwordExpired</code></td><td>Synchronization failed because the user needs to renew its password on the bank website. You should <strong>present this error prominently</strong> and prompt the user for his new password afterwards.</td></tr><tr><td><code>wrongpass</code></td><td>Synchronization failed because the credentials we own are invalid or obsolete. You should <strong>present this error prominently</strong> with <a href="/pages/tbMWC02KvpMXPeJTOa1g#resumerecover-connection-sync">an option to recover the connection using the indications below</a>.</td></tr><tr><td><code>rateLimiting</code></td><td>Synchronization failed because the target website or API is temporarily blocking synchronizations due to rate limiting. We will retry after a delay and connections in this state will be resumed automatically.</td></tr><tr><td><code>websiteUnavailable</code></td><td>Synchronization failed because the targeted API or website is temporarily unavailable. We will periodically retry to sync.</td></tr><tr><td><code>bug</code></td><td>Synchronization failed because of an error from our side. We monitor errors and do our best to fix them quickly. Connections in this state will be resumed automatically after the error is fixed.</td></tr></tbody></table>

For multi-sources connections, we expose the error of any source as an error of the whole connection so the integration can be simplified to checking the connection status. You can also handle the `state` property of each source directly.

### Resume/recover connection sync <a href="#resumerecover-connection-sync" id="resumerecover-connection-sync"></a>

Some connection states require an interaction with the user in order to restore synchronization: `additionalInformationNeeded`, `SCARequired`, `webauthRequired`, `wrongpass`, `decoupled`. You should present recovery options in your app or service to engage the user into completing the required steps.

{% hint style="info" %} <mark style="color:blue;">Since synchronization is suspended until the appropriate action is performed, we advise you to present such errors prominently in your service or app, using banners, indicators or notifications.</mark>
{% endhint %}

You have 2 options to handle connection resuming/recovery :

* use the Reconnect webview;
* build a custom experience and handle the different cases manually.

#### Use our Reconnect webview <a href="#use-our-reconnect-webview" id="use-our-reconnect-webview"></a>

Our webview has a [dedicated endpoint](https://docs.powens.com/api-reference/overview/webview#re-auth--edit-connection-credentials-flow) for connection resuming. It will take care of guiding the user and prompting him the required information if needed.

To present the webview, first [obtain a temporary code](https://docs.powens.com/api-reference/overview/authentication#generate-a-temporary-code) to secure the transaction:

```
GET /auth/token/code
```

```json
{
  "code": "nc0EdV2MiVmSig1…",
  …
}
```

The provided temporary code is valid for a few minutes.\
Then, present the following URL to your user (new lines are only added for clarity):

```
https://{domain}.biapi.pro/2.0/auth/webview/reconnect
  ?client_id={clientId}
  &code={authorizationCode}
  &connection_id={connectionId}
  &redirect_uri={yourCallbackUri}
```

After the webview flow is complete ([either successfully or with an error](https://docs.powens.com/api-reference/overview/webview#implementation-guidelines)), the user will be redirected to your callback URL, and the connection `state` will be updated accordingly.

#### Build a custom user experience <a href="#build-a-custom-user-experience" id="build-a-custom-user-experience"></a>

As an integrator you can also decide to create your own user experience to handle connection resuming. However, the implementation of all steps and cases is a complex task.

{% hint style="warning" %} <mark style="color:orange;">Custom implementations that include transmission of user credentials (login or password) require the Agent Status. The</mark> `wrongpass` <mark style="color:orange;">state</mark> <mark style="color:orange;"></mark><mark style="color:orange;">**cannot**</mark> <mark style="color:orange;"></mark><mark style="color:orange;">be handled if you don't hold this status.</mark>
{% endhint %}

<figure><img src="https://docs.budget-insight.com/assets/img/sca-handling.png" alt=""><figcaption></figcaption></figure>

The steps to take and information to display/prompt depend on the `state` of the connection:

* If the connection is in the `SCARequired` state, the synchronization has not been attempted because it requires an explicit user consent. [Force the connection](https://docs.powens.com/api-reference/user-connections/connections#sync-a-connection) (with no parameter) to trigger the approval demand:

```
POST /connections/{connectionId}
```

The connection will be resumed or set to another error state that must be handled identically.

* If the connection is in the `additionalInformationNeeded` or the `wrongpass` state, the user must be prompted for the required values that are described in the [`fields` property of the connection](https://docs.powens.com/api-reference/user-connections/connections#get-a-connection). The provided values must be [posted on the connection](https://docs.powens.com/api-reference/user-connections/connections#update-a-connection), and the synchronization will resume.

### Example: GET /connections/{connectionId} <a href="#example-get-connectionsconnectionid" id="example-get-connectionsconnectionid"></a>

```json
{
  "state": "additionalInformationNeeded", // or "wrongpass"
  "fields": [ { "name": "otp", "type": "text", "label": "Code d'autorisation", … } ],
  …
}
```

User-provided OTP is to be sent to the API to resume the synchronization:

```
POST /connections/{connectionId}
```

```json
{
  "otp": "123456"
}
```

The connection will be resumed or set to another error state that must be handled identically. Make sure you also handle the `wrongpass` error code that can be raised on posting the credentials.

* If the connection is in the `decoupled` state, an authorization is required using a third-party SCA mechanism (validation in an app or using a dedicated device). In this case you should display a waiting message and [send a resuming signal](https://docs.powens.com/api-reference/user-connections/connections#update-a-connection) to our API:

```
POST /connections/{connectionId}
```

```json
{
  "resume": true
}
```

The connection will be resumed or set to another error state that must be handled identically.

{% hint style="info" %} <mark style="color:blue;">By default, this call will be blocking until validation, so you should handle timeouts in a loop, or implement polling on the client side thanks to the query parameter</mark> `background=true`<mark style="color:blue;">. The connection is in the</mark> `validating` <mark style="color:blue;">state during this step.</mark>
{% endhint %}

```
POST /connections/{connectionId}?background=true
```

```json
{
  "resume": true
}
```

* If the connection is in the `webauthRequired` state, the user has to complete authorization in a browser. You should [obtain a webauth recover URL](https://docs.powens.com/api-reference/user-connections/connections#webauthurl-object) for the connection, and let the user navigate to it:

```
https://{domain}.biapi.pro/2.0/webauth-url
  ?client_id={clientId}
  &id_connection={connectionId}
  &redirect_uri={yourCallbackUri}
```

After the redirection, the connection will be resumed or set to another error state that must be handled identically.

* If the connection is in another error state than above, recovering is not possible.

{% @mermaid/diagram content="graph TB
state1{"Connection<br> state <br>?"}
state2{"Connection<br> state <br>?"}
state1 -->|" #quot;SCARequired#quot; "| forceSync("POST <br> /connections/{id} <br> { }") --> state2
state1 -->|" #quot;additional <br> Information <br> Needed#quot;  or<br> #quot;wrongpass#quot; "| showFields("Prompt user for  fields ") --> postFields(" POST <br> /connections/{id} <br>Field values") --> state2
state1 -->|" #quot;decoupled#quot; "| showDecoupled("Show decoupled<br />message") --> postResume(" POST <br> /connections/{id} <br> { resume: true } ") --> state2
state1 -->|" #quot;webauthRequired#quot; "| webauth("Get auth code<br>Open browser:<br> /webauth?#hellip; ") --> webauthRedirect("Redirection to<br> callback\_uri "<br>with  state  param) --> state2
state2 -->| null | success("Connection is OK!")
state2 -->|"Recoverable error"| loop\[\Loop to first step/]
state2 -->|"Other error"| unrecoverable("Unrecoverable error state")" %}

{% hint style="info" %} <mark style="color:blue;">API calls that raise a synchronization perform a synchronous check of the credentials with the connector, so these requests usually take a few seconds. Make sure you handle them in a user-friendly way.</mark>
{% endhint %}


