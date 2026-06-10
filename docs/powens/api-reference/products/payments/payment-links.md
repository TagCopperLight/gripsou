# Payment Links

{% hint style="success" %}
Authentication: endpoints listed in this page *require* [header authentication](/api-reference/overview/authentication.md) with a *service token* with the `payment-links:admin` scope.
{% endhint %}

## List payment links

<mark style="color:blue;">`GET`</mark> `https://payment-links.powens.com/api/payment-links`

#### Headers

| Name                                            | Type   | Description                  |
| ----------------------------------------------- | ------ | ---------------------------- |
| Authorization<mark style="color:red;">\*</mark> | String | Bearer Authorization header. |

{% tabs %}
{% tab title="200: OK List of payments" %}
Response body: **array of** [#paymentlink-object](#paymentlink-object "mention")
{% endtab %}
{% endtabs %}

## Create a payment link

<mark style="color:green;">`POST`</mark> `https://payment-links.powens.com/api/payment-links`

Request body: [#paymentlinkrequest-object](#paymentlinkrequest-object "mention")

#### Headers

| Name                                            | Type   | Description                  |
| ----------------------------------------------- | ------ | ---------------------------- |
| Authorization<mark style="color:red;">\*</mark> | String | Bearer Authorization header. |

{% tabs %}
{% tab title="200: OK Created payment link" %}
Response body: [#paymentlink-object](#paymentlink-object "mention")
{% endtab %}
{% endtabs %}

## Retrieve a payment link

<mark style="color:blue;">`GET`</mark> `https://payment-links.powens.com/api/payment-links/{id}`

#### Headers

| Name                                            | Type   | Description                  |
| ----------------------------------------------- | ------ | ---------------------------- |
| Authorization<mark style="color:red;">\*</mark> | String | Bearer Authorization header. |

{% tabs %}
{% tab title="200: OK Payment link" %}
Response body: [#paymentlink-object](#paymentlink-object "mention")
{% endtab %}

{% tab title="404: Not Found No such payment link" %}

{% endtab %}
{% endtabs %}

## Revoke a payment link

<mark style="color:green;">`POST`</mark> `https://payment-links.powens.com/api/payment-links/{id}:revoke`

#### Headers

| Name                                            | Type   | Description                  |
| ----------------------------------------------- | ------ | ---------------------------- |
| Authorization<mark style="color:red;">\*</mark> | String | Bearer Authorization header. |

{% tabs %}
{% tab title="204: No Content Payment link revoked" %}

{% endtab %}

{% tab title="404: Not Found No such payment link or already revoked" %}

{% endtab %}
{% endtabs %}

## Request payloads

### *PaymentLinkRequest* object

<table><thead><tr><th width="201.33333333333331">Property</th><th width="165">Type</th><th width="117">Presence<select><option value="3c1c340328d14dbc8877d36cd7a61205" label="Required" color="blue"></option><option value="6adcbdd8f2684c75b082343814d2f5ee" label="Optional" color="blue"></option><option value="d33f6844f251464aaddeb9e40b525dc9" label="Conditional" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>reference_id</code></td><td>String</td><td><span data-option="6adcbdd8f2684c75b082343814d2f5ee">Optional</span></td><td>The end-to-end identifier to provide the underlying payment with.</td></tr><tr><td><code>amount</code></td><td>Number</td><td><span data-option="3c1c340328d14dbc8877d36cd7a61205">Required</span></td><td>The amount of the currency to provide when creating the payment.</td></tr><tr><td><code>currency</code></td><td>String</td><td><span data-option="3c1c340328d14dbc8877d36cd7a61205">Required</span></td><td>The currency code of the payment amount, a per ISO 4217.</td></tr><tr><td><code>label</code></td><td>String</td><td><span data-option="3c1c340328d14dbc8877d36cd7a61205">Required</span></td><td>The unstructured remittance information to provide the created payment.</td></tr><tr><td><code>execution_date</code><br><code>_type</code></td><td>String</td><td><span data-option="3c1c340328d14dbc8877d36cd7a61205">Required</span></td><td>Either <code>"first_open_day"</code> or <code>"instant"</code>.</td></tr><tr><td><code>beneficiary</code></td><td><a href="/pages/ufnJNDcj3aJ7A5Ivp70w#paymentaccount-resource">PaymentAccount</a> object</td><td><span data-option="3c1c340328d14dbc8877d36cd7a61205">Required</span></td><td>The beneficiary for the payment link.</td></tr><tr><td><code>beneficiary</code><br><code>_identity</code></td><td><a href="/pages/ufnJNDcj3aJ7A5Ivp70w#identity-resource">Identity</a> object</td><td><span data-option="3c1c340328d14dbc8877d36cd7a61205">Required</span></td><td>The beneficiary's identity.</td></tr><tr><td><code>payer</code></td><td><a href="/pages/ufnJNDcj3aJ7A5Ivp70w#paymentaccount-resource">PaymentAccount</a> object or null</td><td><span data-option="3c1c340328d14dbc8877d36cd7a61205">Required</span></td><td>The payer for the payment link, if available.</td></tr><tr><td><code>payer_identity</code></td><td><a href="/pages/ufnJNDcj3aJ7A5Ivp70w#identity-resource">Identity</a> object</td><td><span data-option="3c1c340328d14dbc8877d36cd7a61205">Required</span></td><td>The payer's identity.</td></tr><tr><td><code>operator</code><br><code>_identity</code></td><td><a href="/pages/ufnJNDcj3aJ7A5Ivp70w#identity-resource">Identity</a> object</td><td><span data-option="6adcbdd8f2684c75b082343814d2f5ee">Optional</span></td><td>The operator's identity.</td></tr><tr><td><code>redirect</code></td><td>Boolean</td><td><span data-option="3c1c340328d14dbc8877d36cd7a61205">Required</span></td><td>Whether to redirect at the end of the flow or not.</td></tr><tr><td><code>redirect_uri</code></td><td>String or null</td><td><span data-option="d33f6844f251464aaddeb9e40b525dc9">Conditional</span></td><td>The URL to redirect the end user to at the end of the payment link validation.<br><br><em>Must be provided if <code>redirect</code> was set to <code>true</code>.</em></td></tr><tr><td><code>redirect_state</code></td><td>String or null</td><td><span data-option="d33f6844f251464aaddeb9e40b525dc9">Conditional</span></td><td>The optional state with which to redirect the end user at the end of the payment link validation.<br><br><em>Must be provided if <code>redirect</code> was set to <code>true</code>.</em></td></tr></tbody></table>

## Resources

### *PaymentLink* object

<table><thead><tr><th width="201.33333333333331">Property</th><th width="184">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>id</code></td><td>String</td><td>The UUID of the created payment link.</td></tr><tr><td><code>reference_id</code></td><td>String</td><td>The end-to-end identifier to provide the underlying payment with.</td></tr><tr><td><code>amount</code></td><td>Number</td><td>The amount of the currency to provide when creating the payment.</td></tr><tr><td><code>currency</code></td><td>String</td><td>The currency code of the payment amount, a per ISO 4217.</td></tr><tr><td><code>label</code></td><td>String</td><td>The unstructured remittance information to provide the created payment.</td></tr><tr><td><code>execution_date</code><br><code>_type</code></td><td>String</td><td>Either <code>"first_open_day"</code> or <code>"instant"</code>, as defined in <a href="/pages/ufnJNDcj3aJ7A5Ivp70w#executiondate-values"><em>ExecutionDate</em> values</a>.</td></tr><tr><td><code>beneficiary</code></td><td><a href="/pages/ufnJNDcj3aJ7A5Ivp70w#paymentaccount-resource">PaymentAccount</a> object</td><td>The beneficiary for the payment link.</td></tr><tr><td><code>beneficiary</code><br><code>_identity</code></td><td><a href="/pages/ufnJNDcj3aJ7A5Ivp70w#identity-resource">Identity</a> object</td><td>The beneficiary's identity.</td></tr><tr><td><code>payer</code></td><td><a href="/pages/ufnJNDcj3aJ7A5Ivp70w#paymentaccount-resource">PaymentAccount</a> object or null</td><td>The payer for the payment link, if available.</td></tr><tr><td><code>payer_identity</code></td><td><a href="/pages/ufnJNDcj3aJ7A5Ivp70w#identity-resource">Identity</a> object</td><td>The payer's identity.</td></tr><tr><td><code>operator</code><br><code>_identity</code></td><td><a href="/pages/ufnJNDcj3aJ7A5Ivp70w#identity-resource">Identity</a> object</td><td>The operator's identity.</td></tr><tr><td><code>redirect</code></td><td>Boolean</td><td>Whether to redirect at the end of the flow.</td></tr><tr><td><code>redirect_uri</code></td><td>String</td><td>The URL to redirect the end user to at the end of the payment link validation.<br><br><em>If <code>redirect</code> is set to <code>false</code>, this property may be set to an empty string.</em></td></tr><tr><td><code>redirect_state</code></td><td>String</td><td>The optional state with which to redirect the end user at the end of the payment link validation.<br><br><em>If <code>redirect</code> is set to <code>false</code>, this property may be set to an empty string.</em></td></tr><tr><td><code>last_payment_id</code></td><td>Integer or null</td><td>The identifier of the created payment on the domain.</td></tr><tr><td><code>url</code></td><td>String</td><td>The URL for the payment link, to transmit to the end user.</td></tr><tr><td><code>revoked_at</code></td><td>Datetime or null</td><td>The date and time at which the payment link has been or should be revoked, if relevant.</td></tr><tr><td><code>attempt_state</code></td><td><a href="/pages/ufnJNDcj3aJ7A5Ivp70w#paymentstate-values">PaymentState</a> value, <code>"unavailable"</code> or null</td><td>State of the latest payment attempt.<br><br>May be set to <code>"unavailable"</code> if either no payment has been created yet (<code>payment_id</code> is null), or the Payments API is currently unavailable.</td></tr></tbody></table>


