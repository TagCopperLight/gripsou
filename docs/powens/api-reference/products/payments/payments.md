# Payments

## API endpoints

{% hint style="success" %}
Authentication: endpoints listed in this page *require* [header authentication](/api-reference/overview/authentication.md) with a *service token* with the relevant `payments:*` scope.
{% endhint %}

## List payments

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/payments`

By default, payments are ordered by `register_date`.

#### Query Parameters

| Name                        | Type    | Description                                                                                                                                                                  |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| show\_sensitive             | Boolean | Set to true to return sensitive fields from identities. Defaults to false.                                                                                                   |
| limit                       | Integer | Limit the number of results.                                                                                                                                                 |
| offset                      | Integer | First result offset.                                                                                                                                                         |
| reverse                     | Boolean | Reverse the results order (by date).                                                                                                                                         |
| filter                      | String  | Specify the date field to use when using `min_date` and `max_date` filters. Value can be `register_date` or `validate_date`                                                  |
| min\_date                   | Date    | Minimal date (inclusive).                                                                                                                                                    |
| max\_date                   | Date    | Maximal date (exclusive).                                                                                                                                                    |
| connector\_uuid             | String  | Filter by connector UUID. `null` can be used to filter payments without an associated connector.                                                                             |
| id\_connector               | Integer | Filter by connector ID. `null` can be provided to filter payments without an associated connector.                                                                           |
| id\_connector\_source       | Integer | Filter by connector source ID.                                                                                                                                               |
| state                       | String  | Filter by [`state`](#payment-object).                                                                                                                                        |
| error\_code                 | String  | Filter by [`error_code`](#payment-object).                                                                                                                                   |
| bank\_payment\_id           | String  | Filter by bank payment ID.                                                                                                                                                   |
| website                     | String  | Filter by website field value.                                                                                                                                               |
| payer\_identification       | String  | Filter by [`payer.identification`](#paymentaccount-object).                                                                                                                  |
| beneficiary\_identification | String  | Filter by [`beneficiary.identification`](#paymentaccount-object).                                                                                                            |
| reference\_id               | String  | Filter by instruction reference ID                                                                                                                                           |
| execution\_date\_type       | String  | Filter by[`execution_date`](#executiondate-values)                                                                                                                           |
| order\_by                   | String  | Order the payments by the specified field. Value can be `id`, `register_date`, `validate_date`, `state`, `connectors`, `amount`, `instruction_count`, `execution_date_type`. |
| country                     | String  | Filter by country. Several countries can be provided, separated by commas.                                                                                                   |

{% tabs %}
{% tab title="200: OK List of payments" %}
Response body: [#paymentlistresponse-object](#paymentlistresponse-object "mention")
{% endtab %}
{% endtabs %}

## Create a payment

<mark style="color:green;">`POST`</mark> `https://{domain}.biapi.pro/2.0/payments`

For more information on the full payment initiation and validation flow, see [this guide](https://docs.powens.com/documentation/integration-guides/pay/initiating-a-one-time-payment-with-the-webview).

Request body: [#paymentinitrequest-object](#paymentinitrequest-object "mention")

#### Query Parameters

| Name            | Type    | Description                                                                |
| --------------- | ------- | -------------------------------------------------------------------------- |
| show\_sensitive | Boolean | Set to true to return sensitive fields from identities. Defaults to false. |

{% tabs %}
{% tab title="200: OK Payment created" %}
Response body: [#payment-resource](#payment-resource "mention")
{% endtab %}
{% endtabs %}

## Get a payment

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/payments/{paymentId}`

This endpoint should only be used for getting a payment's status on redirect, not for polling; see [this section of the initiation and validation guide](https://docs.powens.com/documentation/integration-guides/pay/initiating-a-one-time-payment-with-the-webview#get-the-payment-status) for more information.

#### Query Parameters

| Name            | Type    | Description                                                                |
| --------------- | ------- | -------------------------------------------------------------------------- |
| show\_sensitive | Boolean | Set to true to return sensitive fields from identities. Defaults to false. |

{% tabs %}
{% tab title="200: OK Payment exists" %}
Response body: [#payment-resource](#payment-resource "mention")
{% endtab %}
{% endtabs %}

## Update, validate or cancel a payment

<mark style="color:green;">`POST`</mark> `https://{domain}.biapi.pro/2.0/payments/{paymentId}`

This is used in the following flows:

:heavy\_minus\_sign: [Cancelling a payment](https://docs.powens.com/documentation/integration-guides/pay/cancelling-a-payment)\
:heavy\_minus\_sign: [Implementing your own payment validation webview (advanced)](https://docs.powens.com/documentation/integration-guides/pay/advanced/implementing-your-own-payment-validation-webview)

Request body: one of the following objects.

:heavy\_minus\_sign:[#paymentvalidaterequest-object](#paymentvalidaterequest-object "mention")\
:heavy\_minus\_sign:[#paymentresumerequest-object](#paymentresumerequest-object "mention")\
:heavy\_minus\_sign:[#paymentsubmitfieldvaluesrequest-object](#paymentsubmitfieldvaluesrequest-object "mention")\
:heavy\_minus\_sign:[#paymentsubmitpsuvalidationrequest-object](#paymentsubmitpsuvalidationrequest-object "mention")\
:heavy\_minus\_sign:[#paymentconfirmrequest-object](#paymentconfirmrequest-object "mention")\
:heavy\_minus\_sign:[#paymentcancelrequest-object](#paymentcancelrequest-object "mention")

#### Query Parameters

| Name            | Type    | Description                                                                |
| --------------- | ------- | -------------------------------------------------------------------------- |
| show\_sensitive | Boolean | Set to true to return sensitive fields from identities. Defaults to false. |

{% tabs %}
{% tab title="200: OK Payment updated" %}
Response body: [#payment-resource](#payment-resource "mention")
{% endtab %}
{% endtabs %}

## Generate a payment-scoped token

<mark style="color:green;">`POST`</mark> `https://{domain}.biapi.pro/2.0/payments/{paymentId}/scopedtoken`

This endpoint **requires** a payment token with the scope `payments:validate`.

Request body: [#paymenttokenrequest-object](#paymenttokenrequest-object "mention")

{% tabs %}
{% tab title="200: OK Token issued" %}
Response body: [#paymenttokenresponse-object](#paymenttokenresponse-object "mention")
{% endtab %}
{% endtabs %}

Note that using the `show_sensitive` parameter requires a payment token with scope `payments:validate` or `payments:allow-sensitive`.

## List a payment connector incompatibilities

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/payments/{paymentId}/incompatibilities`

#### Query Parameters

<table><thead><tr><th width="193">Name</th><th width="164">Type</th><th width="151">Required</th><th>Description</th></tr></thead><tbody><tr><td>all</td><td>Boolean</td><td>No</td><td>Set to true to return incompatibilities for all connectors, including hidden ones.</td></tr></tbody></table>

{% tabs %}
{% tab title="200: OK List of payment connector compatibilities" %}
Response body: Array of [#paymentconnectorincompatibility-resource](#paymentconnectorincompatibility-resource "mention")
{% endtab %}
{% endtabs %}

## Webhooks

### Payment state updated

A `PAYMENT_STATE_UPDATED` webhook is emitted after a payment state has been updated.

Webhook request body: [#payment-resource](#payment-resource "mention")

The `PAYMENT_STATE_UPDATED` event data will be triggered for every payment state change.

{% hint style="warning" %}
If your domain was created before 2024/09/13, the old behaviour of the webhook is used instead.

The `PAYMENT_STATE_UPDATED` event data will only be sent when the payment state is updated in a non-interactive operation. This corresponds to two scenarios:

* The payment request has been validated by the PSU, and during a regular background check on the payment with the bank, we have detected a change in its state.
* The payment request has been validated by the PSU, but they have not been redirected to our callback (network issues, browser closed too early, crash, anomalous behavior of the bank's interface, ...). This case falls back to background checks, as described above.

Please note that if the validation flow succeeds and the new state is communicated in your callback, the webhook will not be triggered until a later update.

To switch to the new behaviour of the webhook, please set the configuration key `payment.state_updated_webhook.systematic` to `'1'`, or contact the support team.
{% endhint %}

## Request payloads

### *PaymentInitRequest* object

{% hint style="info" %}
This model is presented with two-step payment validation in mind, where the initial request is done by your client implementation and the validate request is done by the webview, as described [in the payment webview implementation guide](https://docs.powens.com/documentation/integration-guides/pay/advanced/implementing-your-own-payment-validation-webview#send-the-validation-request).
{% endhint %}

<table><thead><tr><th width="240">Property</th><th>Type</th><th width="113">Presence<select><option value="0e2b93d67e0f43fab770b096c7c778d8" label="Required" color="blue"></option><option value="034d0d7e24ee422b8695b7eaa867d757" label="Optional" color="blue"></option><option value="76a940154d24467c9898f70b817e3c62" label="Conditional" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><del><code>id_connector</code></del></td><td>Integer</td><td><span data-option="034d0d7e24ee422b8695b7eaa867d757">Optional</span></td><td><em>(Deprecated)</em> ID of the bank connector to pre-select for the payment. <br><br>This property is deprecated in favor of <code>connector_uuid</code>.</td></tr><tr><td><code>connector_uuid</code></td><td>String</td><td><span data-option="034d0d7e24ee422b8695b7eaa867d757">Optional</span></td><td>UUID of the bank connector to pre-select for the payment.<br><br>The bank connector must be eligible to payments creation. </td></tr><tr><td><code>client_redirect_uri</code></td><td>String</td><td><span data-option="0e2b93d67e0f43fab770b096c7c778d8">Required</span></td><td>The redirect URL to use when building the validation URL. The provided URL must not contain any query parameter, rely on the <code>client_state</code> parameter for state management.</td></tr><tr><td><code>client_state</code></td><td>String</td><td><span data-option="034d0d7e24ee422b8695b7eaa867d757">Optional</span></td><td>Optional value that will be added as a <code>state</code> query parameter to the redirect URL after validation. If provided, must be 2000 characters or less.</td></tr><tr><td><code>instructions</code></td><td>Array of<br><a href="#paymentinstruction-resource">PaymentInstruction</a> </td><td><span data-option="0e2b93d67e0f43fab770b096c7c778d8">Required</span></td><td>The payment information.</td></tr><tr><td><code>operator_identity</code></td><td><a href="#identity-resource"><em>Identity</em></a> object</td><td><span data-option="034d0d7e24ee422b8695b7eaa867d757">Optional</span></td><td>Detailed identity information about the entity initiating the payment.</td></tr><tr><td><code>payer</code></td><td><a href="#paymentaccount-resource">PaymentAccount</a> object</td><td><span data-option="034d0d7e24ee422b8695b7eaa867d757">Optional</span></td><td>Account information about the payer. This should be provided here in case the information is known beforehand; otherwise, the webview is responsible for requiring it from the end user if necessary.</td></tr><tr><td><code>payer_identity</code></td><td><a href="#identity-resource">Identity</a> object</td><td><span data-option="034d0d7e24ee422b8695b7eaa867d757">Optional</span></td><td>Detailed identity information about the payer/debtor.</td></tr></tbody></table>

### ***PaymentValidateRequest*****&#x20;object**

{% hint style="warning" %}
This section is only useful if you're implementing your own webview; see [the corresponding guide](https://docs.powens.com/documentation/integration-guides/pay/advanced/implementing-your-own-payment-validation-webview) for more details.
{% endhint %}

<table><thead><tr><th width="192">Property</th><th width="163">Type</th><th width="112">Presence<select><option value="a97af6cf55ef45469112ac32fda10b32" label="Required" color="blue"></option><option value="31dea2c97dcb4827bb9095bd49d1fbb2" label="Optional" color="blue"></option><option value="c48bcda299a44e2a89eedf6dad64f1a2" label="Conditional" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><del><code>id_connector</code></del></td><td>Integer</td><td><span data-option="31dea2c97dcb4827bb9095bd49d1fbb2">Optional</span></td><td><em>(Deprecated)</em> ID of the bank connector to use to initiate the payment.<br><br>This property is deprecated in favor of <code>connector_uuid</code>.</td></tr><tr><td><code>connector_uuid</code></td><td>UUID</td><td><span data-option="c48bcda299a44e2a89eedf6dad64f1a2">Conditional</span></td><td>UUID of the bank connector to use to initiate the payment. Note that it may have been pre-selected at payment creation; see <a href="https://docs.powens.com/documentation/integration-guides/pay/advanced/implementing-your-own-payment-validation-webview#select-a-connector-for-the-payment">Select a connector for the payment</a> for more information.<br><br>The bank connector must be eligible to payments creation.</td></tr><tr><td><code>validate</code><br><code>_mechanism</code></td><td>String</td><td><span data-option="a97af6cf55ef45469112ac32fda10b32">Required</span></td><td>Name of the mechanism to use to validate the payment.<br><br><em>Compatibility note: this is set to <code>webauth</code> when not provided for now.</em></td></tr><tr><td><code>fields</code></td><td>String dictionary</td><td><span data-option="c48bcda299a44e2a89eedf6dad64f1a2">Conditional</span></td><td>Encrypted static fields to provide for the payment.<br><br>See <a href="https://docs.powens.com/documentation/integration-guides/advanced/end-to-end-encryption">end-to-end encryption</a> for more details on how to encrypt.</td></tr><tr><td><del><code>website</code></del></td><td>String</td><td><span data-option="c48bcda299a44e2a89eedf6dad64f1a2">Conditional</span></td><td><em>(Deprecated)</em> Value to provide for the payment's <code>website</code> field, if such a field is required by the connector for payments.<br><br>This property is deprecated in favor of <code>fields</code>, which can be used to communicate more fields than just <code>website</code>.</td></tr><tr><td><code>payer</code></td><td><a href="#paymentaccount-resource">PaymentAccount</a><br>object</td><td><span data-option="c48bcda299a44e2a89eedf6dad64f1a2">Conditional</span></td><td>Account information about the payer. This data is required for connectors that need the payer account, if no payer account data has been provided at payment creation.</td></tr><tr><td><code>webview_url</code></td><td>String</td><td><span data-option="a97af6cf55ef45469112ac32fda10b32">Required</span></td><td>URL to which to redirect the end user after <code>redirect</code> actions, for the validation process.</td></tr><tr><td><code>validated</code></td><td>Boolean</td><td><span data-option="31dea2c97dcb4827bb9095bd49d1fbb2">Optional</span></td><td>Provide <code>true</code> to acknowledge payment validation at once. Otherwise, validation is deferred.</td></tr></tbody></table>

### ***PaymentResumeRequest*****&#x20;object**

{% hint style="warning" %}
This section is only useful if you're implementing your own webview; see [the corresponding guide](https://docs.powens.com/documentation/integration-guides/pay/advanced/implementing-your-own-payment-validation-webview) for more details.
{% endhint %}

This is the expected payload when the current action is `decoupled`.

<table><thead><tr><th width="192">Property</th><th width="163">Type</th><th width="112">Presence<select><option value="a97af6cf55ef45469112ac32fda10b32" label="Required" color="blue"></option><option value="31dea2c97dcb4827bb9095bd49d1fbb2" label="Optional" color="blue"></option><option value="c48bcda299a44e2a89eedf6dad64f1a2" label="Conditional" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>resume</code></td><td>Boolean</td><td><span data-option="a97af6cf55ef45469112ac32fda10b32">Required</span></td><td>Must be set to <code>true</code>.</td></tr></tbody></table>

### ***PaymentSubmitFieldValuesRequest*****&#x20;object**

{% hint style="warning" %}
This section is only useful if you're implementing your own webview; see [the corresponding guide](https://docs.powens.com/documentation/integration-guides/pay/advanced/implementing-your-own-payment-validation-webview) for more details.
{% endhint %}

This is the expected payload when the current action is `additionalInformationNeeded`.

<table><thead><tr><th width="192">Property</th><th width="163">Type</th><th width="112">Presence<select><option value="a97af6cf55ef45469112ac32fda10b32" label="Required" color="blue"></option><option value="31dea2c97dcb4827bb9095bd49d1fbb2" label="Optional" color="blue"></option><option value="c48bcda299a44e2a89eedf6dad64f1a2" label="Conditional" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>fields</code></td><td>String dictionary</td><td><span data-option="a97af6cf55ef45469112ac32fda10b32">Required</span></td><td>Cleartext fields to provide for the payment.</td></tr></tbody></table>

### *PaymentSubmitPSUValidationRequest* object

{% hint style="warning" %}
This section is only useful if you're implementing your own webview; see [the corresponding guide](https://docs.powens.com/documentation/integration-guides/pay/advanced/implementing-your-own-payment-validation-webview) for more details.
{% endhint %}

This is the expected payload when the current action is `psuValidation`.

<table><thead><tr><th width="192">Property</th><th width="163">Type</th><th width="112">Presence<select><option value="a97af6cf55ef45469112ac32fda10b32" label="Required" color="blue"></option><option value="31dea2c97dcb4827bb9095bd49d1fbb2" label="Optional" color="blue"></option><option value="c48bcda299a44e2a89eedf6dad64f1a2" label="Conditional" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>psu_validate</code></td><td>Boolean</td><td><span data-option="a97af6cf55ef45469112ac32fda10b32">Required</span></td><td>Must be set to <code>true</code> if the PSU has validated the payment (or if PSU validation is considered implicit), or <code>false</code> otherwise.</td></tr></tbody></table>

### *PaymentConfirmRequest* object

{% hint style="warning" %}
This section is only useful if you're confirming payments manually.
{% endhint %}

This is the expected payload when the current action is `confirm`.

<table><thead><tr><th width="192">Property</th><th width="163">Type</th><th width="112">Presence<select><option value="a97af6cf55ef45469112ac32fda10b32" label="Required" color="blue"></option><option value="31dea2c97dcb4827bb9095bd49d1fbb2" label="Optional" color="blue"></option><option value="c48bcda299a44e2a89eedf6dad64f1a2" label="Conditional" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>confirm</code></td><td>Boolean</td><td><span data-option="a97af6cf55ef45469112ac32fda10b32">Required</span></td><td>Must be set to <code>true</code> if the payment should be confirmed, or <code>false</code> otherwise.</td></tr></tbody></table>

### ***PaymentCancelRequest*****&#x20;object**

<table><thead><tr><th width="197">Property</th><th width="102">Type</th><th width="109">Presence<select><option value="b66888e55c2446f0a7484dbe8cab775f" label="Required" color="blue"></option><option value="6f19bd4321ff4b4caf943153f591e030" label="Optional" color="blue"></option><option value="3076027cc12b487d9372f6e0b64bbd8a" label="Conditional" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>client_redirect</code><br><code>_uri</code></td><td>String</td><td><span data-option="b66888e55c2446f0a7484dbe8cab775f">Required</span></td><td>The redirect URL to use when building the validation URL. The provided URL must not contain any query parameter, rely on the <code>client_state</code> parameter for state management.</td></tr><tr><td><code>client_state</code></td><td>String</td><td><span data-option="6f19bd4321ff4b4caf943153f591e030">Optional</span></td><td>Optional value that will be added as a <code>state</code> query parameter to the redirect URL after validation. If provided, must be 2000 characters or less.</td></tr><tr><td><code>cancel</code></td><td>Boolean</td><td><span data-option="b66888e55c2446f0a7484dbe8cab775f">Required</span></td><td>Provide <code>true</code> to request payment cancellation.</td></tr></tbody></table>

### *PaymentTokenRequest* object

<table><thead><tr><th width="116">Property</th><th width="106">Type</th><th width="108">Presence<select><option value="ae3e8f8ab65e427080b8f7e4976d2f4a" label="Required" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>scope</code></td><td><a href="/pages/QzWAc034jnBgPc1HxOA6#scopes"><em>Scope</em></a> string or array</td><td><span data-option="ae3e8f8ab65e427080b8f7e4976d2f4a">Required</span></td><td>The <code>service</code> permissions to authorize for this token. The scope <code>payments:admin</code> cannot be granted to a restricted payment token.</td></tr></tbody></table>

## Responses

### *PaymentListResponse* object

<table><thead><tr><th width="192">Property</th><th width="240">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>payments</code></td><td>Array of <a href="#payment-resource"><em>Payment</em></a> objects</td><td>List of payments.</td></tr></tbody></table>

### *PaymentTokenResponse* object

<table><thead><tr><th width="178.33333333333331">Property</th><th width="112">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>token</code></td><td>String</td><td>The generated service token.</td></tr><tr><td><code>scope</code></td><td>String</td><td>The attributed permissions for this service token.</td></tr><tr><td><code>id_payment</code></td><td>Integer</td><td>The payment ID linked to the token.</td></tr></tbody></table>

## Code sets

### *IdentityKind* values

<table><thead><tr><th width="287">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>individual</code></td><td>Individual <em>(personne physique)</em>.</td></tr><tr><td><code>corporate</code></td><td>Corporate entity <em>(entreprise)</em>.</td></tr><tr><td><code>non_profit</code></td><td>Non-profit <em>(association)</em>.</td></tr><tr><td><code>government</code></td><td>Government agency <em>(agence gouvernementale)</em>.</td></tr></tbody></table>

### ***IdentitySchemeName*****&#x20;values**

<table><thead><tr><th width="253">Value</th><th width="201">Relevant identity kind<select multiple><option value="ebaca7dbb6dc4224afb8fd682a09c470" label="individual" color="blue"></option><option value="8c4126345ed44abf9cc187bbe2830ed5" label="corporate" color="blue"></option><option value="8db2b67782f546fe8abdd9cfe1eec073" label="non_profit" color="blue"></option><option value="a51298cfb41747c9b5dd68d1209cad54" label="government" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>national_id_number</code></td><td><span data-option="ebaca7dbb6dc4224afb8fd682a09c470">individual</span></td><td>National identification number.</td></tr><tr><td><code>passport_number</code></td><td><span data-option="ebaca7dbb6dc4224afb8fd682a09c470">individual</span></td><td>Passport number.</td></tr><tr><td><code>alien_reg_number</code></td><td><span data-option="ebaca7dbb6dc4224afb8fd682a09c470">individual</span></td><td>Alien registration number.</td></tr><tr><td><code>siren</code></td><td><span data-option="8c4126345ed44abf9cc187bbe2830ed5">corporate, </span><span data-option="8db2b67782f546fe8abdd9cfe1eec073">non_profit</span></td><td>French SIREN company identification number.</td></tr><tr><td><code>incorporation_number</code></td><td><span data-option="8c4126345ed44abf9cc187bbe2830ed5">corporate, </span><span data-option="8db2b67782f546fe8abdd9cfe1eec073">non_profit, </span><span data-option="a51298cfb41747c9b5dd68d1209cad54">government</span></td><td>Incorporation number.</td></tr><tr><td><code>euid</code></td><td><span data-option="8c4126345ed44abf9cc187bbe2830ed5">corporate, </span><span data-option="8db2b67782f546fe8abdd9cfe1eec073">non_profit</span></td><td>European Unique Identifier.</td></tr><tr><td><code>rna</code></td><td><span data-option="8db2b67782f546fe8abdd9cfe1eec073">non_profit</span></td><td>French RNA non profit organization identification number.</td></tr></tbody></table>

### ***PaymentAccountSchemeName*****&#x20;values**

<table><thead><tr><th width="287">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>iban</code></td><td>International Bank Account Number.</td></tr><tr><td><code>sort_code_account_number</code></td><td>United Kingdom local account number.</td></tr></tbody></table>

### ***ExecutionDate*****&#x20;values**

<table><thead><tr><th width="209">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>first_open_day</code></td><td>The payment is executed on the first business day of the bank. For most banks, this excludes the current day.</td></tr><tr><td><code>deferred</code></td><td>The payment will be executed on the given execution date.</td></tr><tr><td><code>instant</code></td><td>The payment will be executed in a short time delay, depending on the payer and beneficiary banks. For most banks, the payment status is final after the payment confirmation.</td></tr><tr><td><code>periodic</code></td><td>The payment is executed periodically at the given frequency.</td></tr></tbody></table>

{% hint style="warning" %}
The `periodic` date type is not available by default. Please check with your commercial contact to enable this feature.
{% endhint %}

### ***ExecutionFrequency*****&#x20;values**

<table><thead><tr><th width="182">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>daily</code></td><td>Every day. Note that most banks do not support this frequency.</td></tr><tr><td><code>weekly</code></td><td>Every week.</td></tr><tr><td><code>two-weekly</code></td><td>Every two weeks.</td></tr><tr><td><code>monthly</code></td><td>Every month.</td></tr><tr><td><code>two-monthly</code></td><td>Every two months.</td></tr><tr><td><code>quarterly</code></td><td>Every three months.</td></tr><tr><td><code>four-monthly</code></td><td>Every four months.</td></tr><tr><td><code>semiannually</code></td><td>Every six months.</td></tr><tr><td><code>yearly</code></td><td>Every year.</td></tr></tbody></table>

### ***PaymentState*****&#x20;values**

<table><thead><tr><th width="175">Value</th><th width="143">Kind<select><option value="bc386b08716e4266ab3c1f054b04a4b7" label="Final state" color="blue"></option><option value="54484cbbedc345e59acd3d98a031ba5b" label="Intermediate state" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>created</code></td><td><span data-option="54484cbbedc345e59acd3d98a031ba5b">Intermediate state</span></td><td>The payment request was registered, but not yet validated.</td></tr><tr><td><code>validating</code></td><td><span data-option="54484cbbedc345e59acd3d98a031ba5b">Intermediate state</span></td><td>The payment request was validated and initialized with the bank. The <code>validate_uri</code> is available.</td></tr><tr><td><code>pending</code></td><td><span data-option="54484cbbedc345e59acd3d98a031ba5b">Intermediate state</span></td><td>The payment request has been validated on the bank website, but execution has not been confirmed yet.</td></tr><tr><td><code>rejected</code></td><td><span data-option="bc386b08716e4266ab3c1f054b04a4b7">Final state</span></td><td>The payment request has been rejected by the bank or the user. The <code>error_code</code> is available.</td></tr><tr><td><code>done</code></td><td><span data-option="bc386b08716e4266ab3c1f054b04a4b7">Final state</span></td><td>The payment has been executed and confirmed by the bank.</td></tr><tr><td><code>accepted</code></td><td><span data-option="bc386b08716e4266ab3c1f054b04a4b7">Final state</span></td><td>The payment has passed acceptance checks from the banks and is awaiting execution. However the bank will not give us further update on the payment state.</td></tr><tr><td><code>expired</code></td><td><span data-option="bc386b08716e4266ab3c1f054b04a4b7">Final state</span></td><td>The payment has automatically expired because it did not have a definitive status (ie done or rejected) N days after its execution. N value is configurable with the <code>payment.manual_expire_time_days</code> configuration key.</td></tr><tr><td><code>partial</code></td><td><span data-option="bc386b08716e4266ab3c1f054b04a4b7">Final state</span></td><td><em>(Only for bulk payments)</em> At least one instruction was rejected, and at least one instruction was either done or accepted.</td></tr></tbody></table>

The full state diagram is the following:

{% @mermaid/diagram content="graph TB
classDef positiveFinal fill:#2c88d9,color:white
classDef negativeFinal fill:#f7c325,color:white
classDef partialFinal fill:#ff7f00,color:white

created("Created")
validating("Validating")
pending("Pending")
done("Done")
accepted("Accepted")
partial("Partial")

created -->|"Payment validated by end user"| validating
validating -->|"Payment validated on the bank app/website"| pending
pending -->|"Payment executed and<br />confirmed by the bank"| done
pending -->|"First controls succeeded<br />but the bank will not<br />return more info"| accepted
pending -->|"Bulk payment<br />with mixed accepted/done<br />and rejected instructions" | partial

direction LR
created -->|"No definitive status after X days"| expired\_after\_created("Expired")
created -->|"Payment cancelled by client/PSU<br />or an error has occurred"| rejected\_after\_created("Rejected")

validating -->|"No definitive status after X days"| expired\_after\_validating("Expired")
validating -->|"Payment refused by bank or end user"| rejected\_after\_validating("Rejected")

pending -->|"No definitive status after X days"| expired\_after\_pending("Expired")
pending -->|"Rejected by bank or<br />cancelled by end user"| rejected\_after\_pending("Rejected")

class done,accepted positiveFinal
class partial partialFinal
class expired\_after\_created,rejected\_after\_created,expired\_after\_validating,rejected\_after\_validating,expired\_after\_pending,rejected\_after\_pending negativeFinal" %}

{% hint style="success" %}
Payment in a final state will not change of state anymore, this is considered as an ending of the payment flow.
{% endhint %}

{% hint style="info" %}
Forward compatibility requirement: additional states may be added in the future. When implementing state handling, always fallback to a non-resolvable generic case for unknown values.
{% endhint %}

### *PaymentStateDetail* values

<table><thead><tr><th width="249">Value</th><th>Description</th></tr></thead><tbody><tr><td><em>(null)</em></td><td>No state detail.</td></tr><tr><td><code>cancelling</code></td><td>The payment is currently being cancelled, and a user action is provided in the <code>action</code> field .</td></tr></tbody></table>

### ***PaymentAction*****&#x20;values**

<table><thead><tr><th width="254">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>redirect</code></td><td>The end user must complete a redirect flow, for which the URL is present in <code>validate_uri</code>.</td></tr><tr><td><code>decoupled</code></td><td>A validation is required from the end user on a side channel, e.g. a mobile app or on a link sent in an email or an SMS.</td></tr><tr><td><code>additionalInformation</code><br><code>Needed</code></td><td>Values for one or more fields are required from the end user. Such fields are provided in <code>fields</code>.</td></tr><tr><td><code>confirm</code></td><td>A confirmation is required from the client.</td></tr><tr><td><code>psuValidation</code></td><td>A validation is required from the end user.</td></tr></tbody></table>

### ***PaymentErrorCode*****&#x20;values**

<table><thead><tr><th width="249">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>invalidEmitter</code></td><td>Identification of the emitter account is invalid, or transfer emission is not possible.</td></tr><tr><td><code>insufficientFunds</code></td><td>The balance of the emitter account is too low.</td></tr><tr><td><code>invalidAmount</code></td><td>The amount of the payment request is invalid or out of the authorized bounds.</td></tr><tr><td><code>invalidCurrency</code></td><td>The currency of the payment request is invalid or unsupported.</td></tr><tr><td><code>invalidDate</code></td><td>The execution date of the payment request is invalid or out of the supported bounds.</td></tr><tr><td><code>invalidBeneficiary</code></td><td>The beneficiary identification is invalid or unsupported.</td></tr><tr><td><code>invalidLabel</code></td><td>The label of the payment request does not match the constraints enforced by the bank.</td></tr><tr><td><code>invalidReferenceId</code></td><td>The reference ID of the payment request is not accepted by the bank.</td></tr><tr><td><code>regulatoryReason</code></td><td>The request was aborted by the bank for regulatory reason (e.g. fraud detection).</td></tr><tr><td><code>authenticationFailed</code></td><td>The request was aborted because the end-user failed to identify with the bank.</td></tr><tr><td><code>noAnswerFromCustomer</code></td><td>The payment request expired without any interaction with the end-user.</td></tr><tr><td><code>noSpecifiedReason</code></td><td>The payment request was rejected by the bank without any reason.</td></tr><tr><td><code>CancelledByUser</code></td><td>The payment was explicitly cancelled by the end-user.</td></tr><tr><td><code>CancelledByClient</code></td><td>The payment has been cancelled through the API.</td></tr><tr><td><code>confirmationRefused</code></td><td>The payment confirmation was refused by the client.</td></tr><tr><td><code>bankMessage</code></td><td>The bank sent an error message to the user.</td></tr><tr><td><code>invalidValue</code></td><td>The request contains invalid data.</td></tr><tr><td><code>websiteUnavailable</code></td><td>The connector is currently unavailable, typically happens if the bank's interface is unreachable.</td></tr><tr><td><code>bug</code></td><td>A bug has occurred during the request validation.</td></tr></tbody></table>

{% hint style="info" %}
Forward compatibility requirement: additional codes may be added in the future. When implementing error handling, always fallback to a generic case for unknown values.
{% endhint %}

### *PaymentInstructionState* values

<table><thead><tr><th width="175">Value</th><th width="143">Kind<select><option value="bc386b08716e4266ab3c1f054b04a4b7" label="Final state" color="blue"></option><option value="54484cbbedc345e59acd3d98a031ba5b" label="Intermediate state" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>pending</code></td><td><span data-option="54484cbbedc345e59acd3d98a031ba5b">Intermediate state</span></td><td>The instruction's execution has not been confirmed yet.</td></tr><tr><td><code>rejected</code></td><td><span data-option="bc386b08716e4266ab3c1f054b04a4b7">Final state</span></td><td>The instruction has been rejected by the bank or the user. The <code>error_code</code> is available.</td></tr><tr><td><code>done</code></td><td><span data-option="bc386b08716e4266ab3c1f054b04a4b7">Final state</span></td><td>The instruction has been executed and confirmed by the bank.</td></tr><tr><td><code>accepted</code></td><td><span data-option="bc386b08716e4266ab3c1f054b04a4b7">Final state</span></td><td>The instruction has passed acceptance checks from the banks and is awaiting execution. However the bank will not give us further update on the payment state.</td></tr></tbody></table>

### ***PaymentFieldType*****&#x20;values**

<table><thead><tr><th width="112">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>text</code></td><td>The field should be displayed as a simple text box.</td></tr><tr><td><code>list</code></td><td>The field should be displayed as a selection widget.</td></tr></tbody></table>

### ***PaymentConnectorIncompatibilityType*****&#x20;values**

| Value          | Description                                                                           |
| -------------- | ------------------------------------------------------------------------------------- |
| `incompatible` | The connector is incompatible with the payment.                                       |
| `warning`      | The connector is compatible but some of the payment properties may cause a rejection. |

### ***PaymentConnectorIncompatibilityCode*****&#x20;values**

<table><thead><tr><th width="206">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>maxAmount</code></td><td>The payment amount is above the known global transfer limit for this connector for this payment type. The PSU may still be able to unlock this limit with their bank.</td></tr><tr><td><code>minAmount</code></td><td>The payment amount is below the minimum amount required by this connector for this payment type.</td></tr><tr><td><code>maxBulk</code></td><td>The number of instructions for this bulk payment is above the maximum number of instructions allowed by the connector.</td></tr><tr><td><code>maxDateDelta</code></td><td>The payment execution date is too far for the connector.</td></tr><tr><td><code>minDateDelta</code></td><td>The payment execution date is not far enough for the connector.</td></tr><tr><td><code>nspDateType</code></td><td>The payment type is not supported by the connector.</td></tr><tr><td><code>nspFrequency</code></td><td>The periodic payment frequency is not supported by the connector.</td></tr><tr><td><code>nspBulk</code></td><td>This connector does not support bulk payments.</td></tr><tr><td><code>nspBenefScheme</code></td><td>The payment beneficiary identification scheme is not supported by the connector.</td></tr><tr><td><code>nspPayer</code></td><td>The connector does not allow providing a payer account.</td></tr><tr><td><code>nspExecDate</code></td><td>The payment execution date is not allowed by the connector.</td></tr><tr><td><code>nspCurrency</code></td><td>The payment currency is not supported by the connector.</td></tr><tr><td><code>trustBenef</code></td><td>The beneficiary needs to be trusted by the payer account.</td></tr></tbody></table>

## **Data structures**

### ***PaymentFieldValue*****&#x20;object**

<table><thead><tr><th width="193">Property</th><th width="164">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>label</code></td><td>String</td><td>Human-readable description of the choice.</td></tr><tr><td><code>value</code></td><td>String</td><td>Technical value to pass to select the value.</td></tr></tbody></table>

### ***PaymentField*****&#x20;object**

<table><thead><tr><th width="193">Property</th><th width="179">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td>String</td><td>Technical name of the field, for the client to use to identify the corresponding value.</td></tr><tr><td><code>type</code></td><td><a href="#paymentfieldtype-values">PaymentFieldType</a> string</td><td>Type of field, to use to display the correct input widget to the end user.</td></tr><tr><td><code>label</code></td><td>String</td><td>Human-readable description of the field.</td></tr><tr><td><code>regex</code></td><td>String or null</td><td>Optional PCRE-compatible pattern for <code>text</code> fields.</td></tr><tr><td><code>required</code></td><td>Boolean</td><td>Whether the field is required or not.</td></tr><tr><td><code>values</code></td><td>Array of <a href="#paymentfieldvalue-object">PaymentFieldValue</a> objects</td><td>Values to choose from for <code>list</code> fields.</td></tr></tbody></table>

## **Resources**

### ***PaymentAccount*****&#x20;resource**

<table><thead><tr><th width="193">Property</th><th width="164">Type</th><th width="116">Presence<select multiple><option value="232ab1c3180a490eb965bfc0bcafa613" label="Required" color="blue"></option><option value="780c6c87fe0e44dd843ed51731fe8133" label="Optional" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>scheme_name</code></td><td><a href="#paymentaccountschemename-values"><em>PaymentAccountSchemeName</em></a> string</td><td><span data-option="232ab1c3180a490eb965bfc0bcafa613">Required</span></td><td>The payment account number type.</td></tr><tr><td><code>identification</code></td><td>String</td><td><span data-option="232ab1c3180a490eb965bfc0bcafa613">Required</span></td><td>The payment account number, of type matching the given <code>scheme_name</code>.</td></tr><tr><td><code>label</code></td><td>String</td><td><span data-option="232ab1c3180a490eb965bfc0bcafa613">Required</span></td><td>Display name of the payment account.</td></tr><tr><td><code>issuer</code></td><td>String</td><td><span data-option="780c6c87fe0e44dd843ed51731fe8133">Optional</span></td><td>The BIC of the payment account (when the <code>scheme_name</code> is <code>iban</code>).</td></tr></tbody></table>

{% hint style="warning" %}
`merchant_scheme_name` and `merchant_identification` have been replaced by the use of `payer_identity` and `beneficiary_identity`.
{% endhint %}

### ***Identity*****&#x20;resource**

<table><thead><tr><th width="251">Property</th><th width="153">Type</th><th width="104">Options<select multiple><option value="38f14e68e6f94d7e9a5b94113a6c7937" label="Sensitive" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>id_user</code></td><td>Integer</td><td></td><td>ID of the <a href="/pages/tHBqInAYUSaJOUYIIs6H">user</a> related to this payment. If provided, this must be an existing User.</td></tr><tr><td><code>kind</code></td><td><a href="#identitykind-values">IdentityKind</a> string</td><td></td><td><p>The kind of entity the identity is linked to.</p><p><br>If not provided, this property is set to <code>individual</code>.</p></td></tr><tr><td><code>external_ref</code></td><td>String</td><td></td><td>External reference assigned by the customer to the entity defined by this Identity. Maximum 255 characters.</td></tr><tr><td><code>first_name</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>First name. Maximum 255 characters.</td></tr><tr><td><code>last_name</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Last name. Maximum 255 characters.</td></tr><tr><td><code>birth_city</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>City of birth.</td></tr><tr><td><code>birth_country</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Country of birth, as an <a href="https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2">ISO 3166-1 alpha-2 code</a>.</td></tr><tr><td><code>birth_date</code></td><td>Date</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Date of birth.</td></tr><tr><td><code>nationality</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Nationality.</td></tr><tr><td><code>postal_address</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Postal address. Maximum 512 characters.</td></tr><tr><td><code>email</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Email address. Maximum 255 characters.</td></tr><tr><td><code>scheme_name</code></td><td><a href="#identityschemename-values"><em>IdentitySchemeName</em></a> string</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Identification number type. Required if <code>identification</code> is provided.</td></tr><tr><td><code>identification</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Identification number. Maximum 255 characters.</td></tr><tr><td><code>issuer</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Issuer of the identification. Maximum 255 characters.</td></tr><tr><td><code>ultimate_owner</code><br><code>_text</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Identity text of the first ultimate owner of the entity.</td></tr><tr><td><code>ultimate_owner</code><br><code>_extra_text</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Identity text for additional ultimate owners of the entity.</td></tr><tr><td><code>pep</code></td><td>Boolean</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Is the person politically exposed. Defaults to <code>false</code>. Maximum 255 characters.</td></tr><tr><td><code>org_name</code></td><td>String</td><td></td><td>Entity name of the organization, required if <code>kind</code> is not <code>individual</code>. Maximum 255 characters.</td></tr><tr><td><code>org_legal_status</code></td><td>String</td><td></td><td>Legal status of the organization, required if <code>kind</code> is not <code>individual</code>. Maximum 128 characters.</td></tr><tr><td><code>org_hq_address</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Headquarters address of the organization, required if <code>kind</code> is not <code>individual</code>. Maximum 512 characters.</td></tr><tr><td><code>org_business_address</code></td><td>String</td><td><span data-option="38f14e68e6f94d7e9a5b94113a6c7937">Sensitive</span></td><td>Business address of the organization, required if <code>kind</code> is not <code>individual</code>. Maximum 512 characters.</td></tr></tbody></table>

Fields marked sensitive are only returned by the API if the `show_sensitive` query parameter is used.

Required properties are the following:

<table><thead><tr><th width="245">Property</th><th>Individual<select><option value="842de864558d4611867f98222aba6e84" label="Mandatory" color="blue"></option><option value="3e4a9558f62341fcb1fbb625d52a7835" label="Recommended" color="blue"></option><option value="312b5d903b6d4c2d88dca9e79d4524fe" label="N/A" color="blue"></option></select></th><th>Corporate<select><option value="01cf71b4589346e98901453e38cbc00c" label="Mandatory" color="blue"></option><option value="c14ac4b7673044d591bf38f60058d0fb" label="Recommended" color="blue"></option><option value="4ea83a58ad6243618649eb9c0874c111" label="N/A" color="blue"></option></select></th><th>Non-profit<select><option value="10ebea2dc05149088397216ba13a11ca" label="Mandatory" color="blue"></option><option value="6253adda5c794d639d93117e4ac7e65a" label="Recommended" color="blue"></option><option value="8c6b8b9b43244c8aafdb374fc1e3a68b" label="N/A" color="blue"></option></select></th><th>Government<select><option value="ff082ebcb4614fc59e5f0dbadf39ff5b" label="Mandatory" color="blue"></option><option value="a36976f655fd43cd8dca559dac96fb24" label="Recommended" color="blue"></option><option value="a98f1c661999468390b5535222853861" label="N/A" color="blue"></option></select></th></tr></thead><tbody><tr><td><code>kind</code></td><td><span data-option="312b5d903b6d4c2d88dca9e79d4524fe">N/A</span></td><td><span data-option="01cf71b4589346e98901453e38cbc00c">Mandatory</span></td><td><span data-option="10ebea2dc05149088397216ba13a11ca">Mandatory</span></td><td><span data-option="ff082ebcb4614fc59e5f0dbadf39ff5b">Mandatory</span></td></tr><tr><td><code>first_name</code></td><td><span data-option="842de864558d4611867f98222aba6e84">Mandatory</span></td><td><span data-option="4ea83a58ad6243618649eb9c0874c111">N/A</span></td><td><span data-option="8c6b8b9b43244c8aafdb374fc1e3a68b">N/A</span></td><td><span data-option="a98f1c661999468390b5535222853861">N/A</span></td></tr><tr><td><code>last_name</code></td><td><span data-option="842de864558d4611867f98222aba6e84">Mandatory</span></td><td><span data-option="4ea83a58ad6243618649eb9c0874c111">N/A</span></td><td><span data-option="8c6b8b9b43244c8aafdb374fc1e3a68b">N/A</span></td><td><span data-option="a98f1c661999468390b5535222853861">N/A</span></td></tr><tr><td><code>birth_city</code></td><td><span data-option="3e4a9558f62341fcb1fbb625d52a7835">Recommended</span></td><td><span data-option="4ea83a58ad6243618649eb9c0874c111">N/A</span></td><td><span data-option="8c6b8b9b43244c8aafdb374fc1e3a68b">N/A</span></td><td><span data-option="a98f1c661999468390b5535222853861">N/A</span></td></tr><tr><td><code>birth_country</code></td><td><span data-option="3e4a9558f62341fcb1fbb625d52a7835">Recommended</span></td><td><span data-option="4ea83a58ad6243618649eb9c0874c111">N/A</span></td><td><span data-option="8c6b8b9b43244c8aafdb374fc1e3a68b">N/A</span></td><td><span data-option="a98f1c661999468390b5535222853861">N/A</span></td></tr><tr><td><code>birth_date</code></td><td><span data-option="3e4a9558f62341fcb1fbb625d52a7835">Recommended</span></td><td><span data-option="4ea83a58ad6243618649eb9c0874c111">N/A</span></td><td><span data-option="8c6b8b9b43244c8aafdb374fc1e3a68b">N/A</span></td><td><span data-option="a98f1c661999468390b5535222853861">N/A</span></td></tr><tr><td><code>org_name</code></td><td><span data-option="312b5d903b6d4c2d88dca9e79d4524fe">N/A</span></td><td><span data-option="c14ac4b7673044d591bf38f60058d0fb">Recommended</span></td><td><span data-option="6253adda5c794d639d93117e4ac7e65a">Recommended</span></td><td><span data-option="a36976f655fd43cd8dca559dac96fb24">Recommended</span></td></tr><tr><td><code>scheme_name</code></td><td><span data-option="312b5d903b6d4c2d88dca9e79d4524fe">N/A</span></td><td><span data-option="01cf71b4589346e98901453e38cbc00c">Mandatory</span></td><td><span data-option="10ebea2dc05149088397216ba13a11ca">Mandatory</span></td><td><span data-option="ff082ebcb4614fc59e5f0dbadf39ff5b">Mandatory</span></td></tr><tr><td><code>identification</code></td><td><span data-option="312b5d903b6d4c2d88dca9e79d4524fe">N/A</span></td><td><span data-option="01cf71b4589346e98901453e38cbc00c">Mandatory</span></td><td><span data-option="10ebea2dc05149088397216ba13a11ca">Mandatory</span></td><td><span data-option="ff082ebcb4614fc59e5f0dbadf39ff5b">Mandatory</span></td></tr></tbody></table>

Examples identities are the following:

{% tabs %}
{% tab title="Individual" %}

```json
{
    "kind": "individual",
    "first_name": "Jean",
    "last_name": "Dupont",
    "birth_city": "Paris",
    "birth_country": "FR",
    "birth_date": "1990-12-31"
}
```

{% endtab %}

{% tab title="Individual without birth data" %}

```json
{
    "kind": "individual",
    "first_name": "Jean",
    "last_name": "Dupont",
    "nationality": "FR",
    "postal_address": "Appartement 25\nEntrée B Résidence Les Iris\n3 Boulevard du Levant\n95220 HERBLAY",
    "external_ref": "MY-CUSTOMER-REFERENCE-012345678"
}
```

{% endtab %}

{% tab title="Company" %}

```json
{
    "kind": "corporate",
    "org_name": "Powens",
    "org_legal_status": "SAS",
    "org_hq_address": "84 RUE BEAUBOURG\n75003 PARIS 3\nFRANCE",
    "scheme_name": "siren",
    "identification": "749867206"
}
```

{% endtab %}

{% tab title="Non-profit" %}

```json
{
    "kind": "non_profit",
    "org_name": "Scouts et Guides de France",
    "org_legal_status": "Association loi du 1er juillet 1901",
    "org_hq_address": "21-37-BAT D 2E ETAGE, 21 RUE DE STALINGRAD, 94110 ARCUEIL",
    "scheme_name": "rna",
    "identification": "W751001142"
}
```

{% endtab %}
{% endtabs %}

### ***PaymentInstruction*****&#x20;resource**

{% hint style="info" %}
End-to-end identifiers (represented by the `reference_id` property) vary in length depending on the payment instrument used:

* SEPA Credit Transfers use 31 characters long end-to-end identifiers.
* Domestic UK payments using Faster Payments use 18 characters long end-to-end identifiers.

It is recommended **not** to provide end-to-end identifiers, so that the API can generate such of correct lengths depending on the situation.

<details>

<summary>Example</summary>

See an example when creating a bulk payment with 2 instructions without providing the `reference_id`:

{% code title="Request" %}

```json
POST /payments
{
  "client_redirect_uri": "http://example.org",
  "instructions": [
    {
      "label": "Payment test",
      "amount": "1",
      "currency": "EUR",
      "execution_date_type": "first_open_day",
      "beneficiary": {
        "scheme_name": "iban",
        "identification": "FR4630003000704114151355Z51",
        "label": "Fake IBAN"
      }
    },
    {
      "label": "Payment test 2",
      "amount": "1",
      "currency": "EUR",
      "execution_date_type": "first_open_day",
      "beneficiary": {
        "scheme_name": "iban",
        "identification": "FR1420041010050500013M02606",
        "label": "Fake IBAN"
      }
    }
  ]
}
```

{% endcode %}

{% code title="Response" %}

```json
{
  "id": 1975,
  "state": "created",
  "error_code": null,
  "error_description": null,
  "register_date": "2022-09-29 08:05:30",
  "validate_uri": null,
  "client_redirect_uri": "http://example.org",
  "state_detail": null,
  "id_connector": null,
  "instructions": [
    {
      "reference_id": "10mrPLcJVSlf7YFnX6MsfmRfnQT-1",
      "execution_date_type": "first_open_day",
      "label": "Payment test",
      "amount": 1.0000000000,
      "currency": {
        "id": "EUR",
        "symbol": "€",
        "prefix": false,
        "crypto": false,
        "precision": 2,
        "marketcap": null,
        "datetime": null,
        "name": "Euro"
      },
      "exec_date": null,
      "execution_date": null,
      "beneficiary": {
        "id": 6313,
        "id_account": null,
        "label": "Fake IBAN",
        "scheme_name": "iban",
        "identification": "FR4630003000704114151355Z51",
        "issuer": "SOGEFRPPXXX",
        "disabled_date": null,
        "merchant_scheme_name": null,
        "merchant_identification": null,
        "bic": "SOGEFRPPXXX"
      }
    },
    {
      "reference_id": "10mrPLcJVSlf7YFnX6MsfmRfnQT-2",
      "execution_date_type": "first_open_day",
      "label": "Payment test 2",
      "amount": 1.0000000000,
      "currency": {
        "id": "EUR",
        "symbol": "€",
        "prefix": false,
        "crypto": false,
        "precision": 2,
        "marketcap": null,
        "datetime": null,
        "name": "Euro"
      },
      "exec_date": null,
      "execution_date": null,
      "beneficiary": {
        "id": 6314,
        "id_account": null,
        "label": "Fake IBAN",
        "scheme_name": "iban",
        "identification": "FR1420041010050500013M02606",
        "issuer": "SOGEFRPPXXX",
        "disabled_date": null,
        "merchant_scheme_name": null,
        "merchant_identification": null,
        "bic": "SOGEFRPPXXX"
      }
    }
  ]
}
```

{% endcode %}

</details>
{% endhint %}

<table><thead><tr><th width="249">Property</th><th width="163">Type</th><th width="110">Presence<select><option value="d0e4d38ee26d46a28e2fb6b3a84ab0b9" label="Optional" color="blue"></option><option value="44739bb72d3644ab92e0eaa182ab3378" label="Required" color="blue"></option><option value="94ea832ae4fc4a4184c1b3c267509443" label="Computed" color="blue"></option><option value="41d13bd62b3941bfa7cc7954df72922f" label="Conditional" color="blue"></option></select></th><th>Description</th></tr></thead><tbody><tr><td><code>reference_id</code></td><td>String</td><td><span data-option="d0e4d38ee26d46a28e2fb6b3a84ab0b9">Optional</span></td><td>The optional end-to-end identifier for the instruction. If not provided, a random identifier is generated (maximum 31 characters).</td></tr><tr><td><code>amount</code></td><td>Number</td><td><span data-option="44739bb72d3644ab92e0eaa182ab3378">Required</span></td><td>The amount of the payment.</td></tr><tr><td><code>currency</code></td><td>String</td><td><span data-option="44739bb72d3644ab92e0eaa182ab3378">Required</span></td><td>The currency code of the payment amount, a per ISO 4217.</td></tr><tr><td><code>label</code></td><td>String</td><td><span data-option="44739bb72d3644ab92e0eaa182ab3378">Required</span></td><td>Label of the payment.</td></tr><tr><td><code>execution_date_type</code></td><td><a href="#executiondate-values"><em>ExecutionDate</em></a> string</td><td><span data-option="44739bb72d3644ab92e0eaa182ab3378">Required</span></td><td>The execution date type of the payment.</td></tr><tr><td><code>execution_date</code></td><td>Date</td><td><span data-option="41d13bd62b3941bfa7cc7954df72922f">Conditional</span></td><td>The execution date for the transfer, only for <code>deferred</code> transfers. Must be a UTC date.</td></tr><tr><td><code>beneficiary</code></td><td><a href="#paymentaccount-resource"><em>PaymentAccount</em></a> object</td><td><span data-option="44739bb72d3644ab92e0eaa182ab3378">Required</span></td><td>The beneficiary information for the payment instruction.</td></tr><tr><td><code>beneficiary_identity</code></td><td><a href="#identity-resource"><em>Identity</em></a> object</td><td><span data-option="d0e4d38ee26d46a28e2fb6b3a84ab0b9">Optional</span></td><td>Detailed identity information about the beneficiary.</td></tr><tr><td><code>start_date</code></td><td>Date</td><td><span data-option="41d13bd62b3941bfa7cc7954df72922f">Conditional</span></td><td>The starting date for <code>periodic</code> transfers. Required if <code>execution_date_type</code> is <code>periodic</code>.</td></tr><tr><td><code>end_date</code></td><td>Date</td><td><span data-option="d0e4d38ee26d46a28e2fb6b3a84ab0b9">Optional</span></td><td>The ending date for <code>periodic</code> transfers. If none is provided, the transfer will be executed indefinitely until stopped manually.</td></tr><tr><td><code>frequency</code></td><td><a href="#executionfrequency-values"><em>Execution</em><br><em>Frequency</em></a> string</td><td><span data-option="41d13bd62b3941bfa7cc7954df72922f">Conditional</span></td><td>The frequency of execution for <code>periodic</code> transfers. Required if <code>execution_date_type</code> is <code>periodic</code>.</td></tr><tr><td><code>state</code></td><td><a href="#paymentinstructionstate-values">PaymentInstructionState</a> string or null</td><td><span data-option="94ea832ae4fc4a4184c1b3c267509443">Computed</span></td><td>The current state of the instruction.</td></tr></tbody></table>

### ***Payment*****&#x20;resource**

<table><thead><tr><th width="201.33333333333331">Property</th><th width="184">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>id</code></td><td>Integer</td><td>The ID of the created payment request.</td></tr><tr><td><code>state</code></td><td><a href="#paymentstate-values"><em>PaymentState</em></a> string</td><td>The state of the payment request.</td></tr><tr><td><code>state_detail</code></td><td><a href="#paymentstatedetail-values">PaymentStateDetail</a> value</td><td>The state detail of the payment request.</td></tr><tr><td><code>action</code></td><td><a href="#paymentaction-values"><em>PaymentAction</em></a> string or null</td><td>The current action taking place on the payment request.</td></tr><tr><td><code>error_code</code></td><td><a href="#paymenterrorcode-values"><em>PaymentErrorCode</em></a> string or null</td><td>The error code of the payment request.</td></tr><tr><td><code>error</code><br><code>_description</code></td><td>String or null</td><td>Error message in case of an error.</td></tr><tr><td><code>fields</code></td><td>Dictionary of <a href="#paymentfield-object"><em>PaymentField</em></a> objects</td><td>Fields to provide to the payment for <code>additionalInformationNeeded</code> actions.</td></tr><tr><td><code>validate_uri</code></td><td>String or null</td><td>URL to which to redirect the end user for <code>redirect</code> actions.</td></tr><tr><td><code>id_connector</code></td><td>Integer or null</td><td><p><em>(Deprecated)</em> ID of the bank connector to use to initiate the payment.</p><p><br>This property is deprecated in favor of <code>connector_uuid</code>.</p></td></tr><tr><td><code>connector_uuid</code></td><td>UUID or null</td><td>UUID of the bank connector to use to initiate the payment.</td></tr><tr><td><code>validate</code><br><code>_mechanism</code></td><td>String or null</td><td>The chosen validation mechanism for the payment.</td></tr><tr><td><code>register_date</code></td><td>DateTime</td><td>Creation date of the payment request.</td></tr><tr><td><del><code>client_redirect_uri</code></del></td><td>String or null</td><td><em>(Deprecated)</em> The final callback URL to redirect the end user to at the end of the payment validation process.<br><br><strong>Prefer using the <code>redirect_uri</code> parameter to the</strong> <a href="/pages/tZ3WGBVHcnlDIZM5vumO#validate-a-payment"><strong>payment validation webview</strong></a> <strong>instead.</strong></td></tr><tr><td><del><code>client_state</code></del></td><td>String or null</td><td><em>(Deprecated)</em> The optional state to add to the final callback URL.<br><br><strong>Prefer using the <code>state</code> parameter to the</strong> <a href="/pages/tZ3WGBVHcnlDIZM5vumO#validate-a-payment"><strong>payment validation webview</strong></a> <strong>instead.</strong></td></tr><tr><td><code>payer</code></td><td><a href="#paymentaccount-resource"><em>PaymentAccount</em></a> object</td><td>The payer information for the payment.</td></tr><tr><td><code>instructions</code></td><td>Array of <a href="#paymentinstruction-resource"><em>PaymentInstruction</em></a> objects</td><td>The list of payment instructions.</td></tr><tr><td><code>payer_identity</code></td><td><a href="#identity-resource"><em>Identity</em></a> object</td><td>Detailed identity information about the payer/debtor.</td></tr></tbody></table>

### ***PaymentConnectorIncompatibility*****&#x20;resource**

<table><thead><tr><th width="181">Property</th><th width="360">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><a href="#paymentconnectorincompatibilitytype-values">PaymentConnectorIncompatibilityType</a> string</td><td>Whether the payment is incompatible with the connector, or if it's simply a warning.</td></tr><tr><td><code>reasons</code></td><td>Array of <a href="#paymentconnectorincompatibilityreason-resource">PaymentConnectorIncompatibilityReason</a> objects</td><td>The exhaustive list of reasons causing warnings or incompatibilities.</td></tr></tbody></table>

### ***PaymentConnectorIncompatibilityReason*****&#x20;resource**

<table><thead><tr><th width="202">Property</th><th width="324">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>code</code></td><td><a href="#paymentconnectorincompatibilitycode-values">PaymentConnectorIncompatibilityCode</a> string</td><td>The compatibility code. Indicates the nature of the incompatibility or warning.</td></tr><tr><td><code>type</code></td><td><a href="#paymentconnectorincompatibilitytype-values">PaymentConnectorIncompatibilityType</a> string</td><td>Whether the reason caused a warning or incompatibility.</td></tr><tr><td><code>description</code></td><td>string</td><td>Technical description of the incompatibility code.</td></tr><tr><td><code>value_connector</code></td><td>String or Decimal or Bool or Array or Object</td><td>For parametrized incompatibility rules, this is the value associated to the connector to put in comparison with the value exposed in <code>value_payment</code>.</td></tr><tr><td><code>value_payment</code></td><td>String or Decimal or Bool or Array or Object</td><td>For parametrized incompatibility rules, this is the value associated to the payment to put in comparison with the value exposed in <code>value_connector</code>.</td></tr></tbody></table>


