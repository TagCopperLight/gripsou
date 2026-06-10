# Transfers (obsolete)

{% hint style="info" %}
The <mark style="background-color:orange;">Pay product</mark> should be preferred to these services as it handles PSD2-compliant use-cases.
{% endhint %}

## API endpoints

{% hint style="success" %}
Authentication: endpoints listed in this page *require* [header authentication](/api-reference/overview/authentication.md) with a *user token*.
{% endhint %}

## List recipients

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/recipients`

#### Path Parameters

| Name                                     | Type            | Description             |
| ---------------------------------------- | --------------- | ----------------------- |
| userId<mark style="color:red;">\*</mark> | Integer or "me" | ID of the related user. |

{% tabs %}
{% tab title="200: OK List of recipients" %}
Response body: [#recipientslist-object](#recipientslist-object "mention")
{% endtab %}

{% tab title="409: Conflict No bank account is activated" %}
Response body: [Errors](/api-reference/overview/errors.md#error-response) with `noAccount` code
{% endtab %}
{% endtabs %}

{% code title="Filtered route alias:" %}

```
/accounts/{accountId}/recipients
```

{% endcode %}

## List recipient categories

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/recipientCategories`

#### Path Parameters

| Name                                     | Type            | Description             |
| ---------------------------------------- | --------------- | ----------------------- |
| userId<mark style="color:red;">\*</mark> | Integer or "me" | ID of the related user. |

{% tabs %}
{% tab title="200: OK List of recipient categories" %}
Response body: [#recipientcategorieslist-object](#recipientcategorieslist-object "mention")
{% endtab %}
{% endtabs %}

## Add a recipient

<mark style="color:green;">`POST`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/accounts/{accountId}/recipients`

Request body: [#recipientcreationrequest-object](#recipientcreationrequest-object "mention")

#### Path Parameters

| Name                                        | Type            | Description                |
| ------------------------------------------- | --------------- | -------------------------- |
| userId<mark style="color:red;">\*</mark>    | Integer or "me" | ID of the related user.    |
| accountId<mark style="color:red;">\*</mark> | Integer         | ID of the related account. |

{% tabs %}
{% tab title="200: OK Recipient created" %}
Response body: [#recipient-object](#recipient-object "mention")
{% endtab %}
{% endtabs %}

## Update a recipient

<mark style="color:green;">`POST`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/accounts/{accountId}/recipients/{recipientId}`

Request body: Key-value object build from the requested [`fields`](#recipient-object).

#### Path Parameters

| Name                                          | Type            | Description                |
| --------------------------------------------- | --------------- | -------------------------- |
| userId<mark style="color:red;">\*</mark>      | Integer or "me" | ID of the related user.    |
| accountId<mark style="color:red;">\*</mark>   | Integer         | ID of the related account. |
| recipientId<mark style="color:red;">\*</mark> | Integer         | ID of the recipient.       |

{% tabs %}
{% tab title="200: OK Recipient updated" %}
Response body: [#recipient-object](#recipient-object "mention")
{% endtab %}
{% endtabs %}

## Create a transfer

<mark style="color:green;">`POST`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/transfers`

Request body: [#transfercreationrequest-object](#transfercreationrequest-object "mention")

#### Path Parameters

| Name                                     | Type            | Description             |
| ---------------------------------------- | --------------- | ----------------------- |
| userId<mark style="color:red;">\*</mark> | Integer or "me" | ID of the related user. |

{% tabs %}
{% tab title="200: OK Transfer created" %}
Response body: [#transfer-object](#transfer-object "mention")
{% endtab %}

{% tab title="400: Bad Request Maximum amount exceeded" %}
The maximum transfer amount available, enforced by the bank or our API, has been exceeded.\
\
Response body: [Errors](/api-reference/overview/errors.md#error-response) with `maxAmountExceeded` code, and optionally a `max_amount` key with the maximum amount.
{% endtab %}

{% tab title="400: Bad Request Maximum period amount exceeded" %}
The maximum transfer amount available on a cooling period, enforced by the bank or our API, has been exceeded.\
\
Response body: [Errors](/api-reference/overview/errors.md#error-response) with `maxPeriodAmountExceeded` code, and optionally a `max_amount` key with the maximum amount.
{% endtab %}
{% endtabs %}

## List transfers

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/transfers`

#### Path Parameters

| Name                                     | Type            | Description             |
| ---------------------------------------- | --------------- | ----------------------- |
| userId<mark style="color:red;">\*</mark> | Integer or "me" | ID of the related user. |

{% tabs %}
{% tab title="200: OK List of transfers" %}
Response body: [#transferslist-object](#transferslist-object "mention")
{% endtab %}

{% tab title="409: Conflict No bank account is activated" %}
Response body: [Errors](/api-reference/overview/errors.md#error-response) with `noAccount` code
{% endtab %}
{% endtabs %}

## Get a transfer

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/transfers/{transferId}`

Get a single transfer by ID.

#### Path Parameters

| Name                                         | Type            | Description             |
| -------------------------------------------- | --------------- | ----------------------- |
| userId<mark style="color:red;">\*</mark>     | Integer or "me" | ID of the related user. |
| transferId<mark style="color:red;">\*</mark> | Integer         | ID of the transfer.     |

{% tabs %}
{% tab title="200: OK Transfer details" %}
Response body: [#transfer-object](#transfer-object "mention")
{% endtab %}
{% endtabs %}

## Update a transfer

<mark style="color:green;">`POST`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/transfers/{transferId}`

Request body: [#transferupdaterequest-object](#transferupdaterequest-object "mention")

#### Path Parameters

| Name                                          | Type            | Description                |
| --------------------------------------------- | --------------- | -------------------------- |
| userId<mark style="color:red;">\*</mark>      | Integer or "me" | ID of the related user.    |
| accountId<mark style="color:red;">\*</mark>   | Integer         | ID of the related account. |
| recipientId<mark style="color:red;">\*</mark> | Integer         | ID of the recipient.       |

{% tabs %}
{% tab title="200: OK Transfer updated" %}
Response body: [#transfer-object](#transfer-object "mention")
{% endtab %}
{% endtabs %}

## Data model

### *RecipientsList* object

| Property     | Type                                              | Description         |
| ------------ | ------------------------------------------------- | ------------------- |
| `recipients` | Array of [*Recipient*](#recipient-object) objects | List of recipients. |

### *Recipient* object

<table><thead><tr><th width="194.33333333333331">Property</th><th width="181">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>id</code></td><td>Integer</td><td>ID of the recipient.</td></tr><tr><td><code>id_account</code></td><td>Integer</td><td>ID of the related <em>emitter</em> bank account.</td></tr><tr><td><code>id_target_account</code></td><td>Integer or null</td><td>If this recipient represents a known aggregated account as an internal transfer destination, ID of the related <em>destination</em> bank account.</td></tr><tr><td><code>label</code></td><td>String</td><td>Name of the recipient.</td></tr><tr><td><code>iban</code></td><td>String or null</td><td>IBAN of the recipient, if available.</td></tr><tr><td><code>bic</code></td><td>String or null</td><td>BIC code of the recipient, if available.</td></tr><tr><td><code>bank_name</code></td><td>String or null</td><td>Name of the bank holding the recipient account, if available.</td></tr><tr><td><code>enabled_at</code></td><td>DateTime or null</td><td>Enable date of the recipents. Transfers to disabled recipients is not possible.</td></tr><tr><td><code>state</code></td><td><a href="#recipientstate-values"><em>RecipientState</em></a> string of null</td><td>The sync status of this recipient. The null value indicates a successful sync.</td></tr><tr><td><code>fields</code></td><td>Array of <a href="/pages/aEgj6uKNfjLxPdpZ831x#connectorfield-object"><em>ConnectorField</em></a> objects or null</td><td>If validation of the recipient requires credentials input, this list of relevant fields that must be prompted to the end-user.</td></tr><tr><td><code>error_message</code></td><td>String or null</td><td>If the recipient is in an error state, the optional bank message.</td></tr></tbody></table>

### ***RecipientState*****&#x20;values**

<table><thead><tr><th width="319">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>wrongpass</code></td><td>The authentication on website has failed.</td></tr><tr><td><code>additionalInformationNeeded</code></td><td>Additional information is needed such as an OTP.</td></tr><tr><td><code>websiteUnavailable</code></td><td>The connector website is unavailable.</td></tr><tr><td><code>actionNeeded</code></td><td>An action is needed on the website by the user, scraping is blocked.</td></tr><tr><td><code>decoupled</code></td><td>Requires a user validation on a third-party app or device (ex: digital key).</td></tr><tr><td><code>bug</code></td><td>A bug has occurred during the synchronization.</td></tr></tbody></table>

### *RecipientCategoriesList* object

<table><thead><tr><th width="197">Property</th><th width="170.33333333333331">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>categories</code></td><td>Array of strings</td><td>List of recipient categories.</td></tr></tbody></table>

### *RecipientCreationRequest* object

<table><thead><tr><th width="156">Property</th><th width="98">Type</th><th width="100">Required</th><th>Description</th></tr></thead><tbody><tr><td><code>iban</code></td><td>String</td><td>Yes</td><td>The IBAN of the recipient.</td></tr><tr><td><code>label</code></td><td>String</td><td>Yes</td><td>The name of the recipient.</td></tr><tr><td><code>category</code></td><td>String</td><td>No</td><td>The category of the recipient, if needed.</td></tr><tr><td><code>background</code></td><td>Boolean</td><td>No</td><td>Flag to make the request asynchronous (i.e. the API will respond immediately and process the registration with the bank in background). When using this option, you must implement polling on the recipient to monitor the state.</td></tr></tbody></table>

### ***TransferCreationRequest*****&#x20;object**

<table><thead><tr><th width="174">Name</th><th width="165">Type</th><th width="99">Required</th><th>Description</th></tr></thead><tbody><tr><td><code>id_account</code></td><td>Integer</td><td>Yes</td><td>ID of the emitter account.</td></tr><tr><td><code>amount</code></td><td>Decimal</td><td>Yes</td><td>Amount of the transfer. The currency is set by the emitter account.</td></tr><tr><td><code>label</code></td><td>String</td><td>No</td><td>Label of the transfer.</td></tr><tr><td><code>beneficiary_type</code></td><td><a href="#beneficiarytype-values"><em>BeneficiaryType</em></a> string</td><td>Yes</td><td>Type of beneficiary.</td></tr><tr><td><code>id_recipient</code></td><td>Integer</td><td>No</td><td>ID of the recipient, for the <code>recipient</code> beneficiary type.</td></tr><tr><td><code>beneficiary_number</code></td><td>String</td><td>No</td><td>Identification of the beneficiary, according to the <code>beneficiary_type</code>: IBAN or phone number.</td></tr><tr><td><code>beneficiary_label</code></td><td>String</td><td>No</td><td>Name of the beneficiary for the <code>iban</code> or <code>phone_number</code> types.</td></tr><tr><td><code>validated</code></td><td>Boolean</td><td>No</td><td>Flag to validate the transfer (submit to the bank).</td></tr><tr><td><code>background</code></td><td>Boolean</td><td>No</td><td>Flag to make the validation request asynchronous (i.e. the API will respond immediately and process the validation with the bank in background). When using this option, you must implement polling on the transfer to monitor the state.</td></tr></tbody></table>

### ***BeneficiaryType*****&#x20;values**

<table><thead><tr><th width="183">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>recipient</code></td><td>Transfer to a registered beneficiary.</td></tr><tr><td><code>iban</code></td><td>Direct transfer to an IBAN (without beneficiary addition).</td></tr><tr><td><code>phone_number</code></td><td>Direct transfer to a phone number (without beneficiary addition).</td></tr></tbody></table>

### ***Transfer*****&#x20;object**

<table><thead><tr><th width="171.33333333333331">Property</th><th width="190">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>id</code></td><td>Integer</td><td>ID of the transfer.</td></tr><tr><td><code>id_account</code></td><td>Integer or null</td><td>ID of the related <em>emitter</em> bank account.</td></tr><tr><td><code>id_recipient</code></td><td>Integer or null</td><td>ID of the recipient, for the <code>recipient</code> beneficiary type.</td></tr><tr><td><code>beneficiary_type</code></td><td><a href="#beneficiarytype-values"><em>BeneficiaryType</em></a> string</td><td>Type of beneficiary.</td></tr><tr><td><code>beneficiary_number</code></td><td>String or null</td><td>Identification of the beneficiary, according to the <code>beneficiary_type</code>: IBAN or phone number.</td></tr><tr><td><code>exec_date</code></td><td>Date or null</td><td>Execution date of the transfer.</td></tr><tr><td><code>amount</code></td><td>Decimal</td><td>Amount of the transfer.</td></tr><tr><td><code>currency</code></td><td><a href="/pages/HmWmHsTZQ5ujENC5Pnie#currency-object"><em>Currency</em></a> object</td><td>Currency of the transfer.</td></tr><tr><td><code>label</code></td><td>String</td><td>Label of the transfer.</td></tr><tr><td><code>state</code></td><td><a href="#transferstate-values"><em>TransferState</em></a> string or null</td><td>State of the transfer.</td></tr><tr><td><code>fields</code></td><td>Array of <a href="/pages/aEgj6uKNfjLxPdpZ831x#connectorfield-object"><em>ConnectorField</em></a> objects or null</td><td>If validation of the transfer requires credentials input, this list of relevant fields must be prompted to the end-user.</td></tr><tr><td><code>validate_mechanism</code></td><td><a href="#transfervalidatemechanism-values"><em>TransferValidateMechanism</em></a> string</td><td>The mechanism to use to validate the transfer.</td></tr><tr><td><code>error_message</code></td><td>String or null</td><td>If the transfer is in an error state, the optional bank message.</td></tr></tbody></table>

### ***TransferState*****&#x20;values**

<table><thead><tr><th width="260">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>created</code></td><td>The transfer is created in our API but not yet validated with the bank.</td></tr><tr><td><code>validating</code></td><td>The transfer is being submitted to the bank.</td></tr><tr><td><code>scheduled</code></td><td>The transfer has been submitted to the bank and is scheduled for future execution.</td></tr><tr><td><code>pending</code></td><td>The transfer has been submitted to the bank, execution is in progress.</td></tr><tr><td><code>done</code></td><td>The transfer has been confirmed by the bank.</td></tr><tr><td><code>canceled</code></td><td>The transfer has been explicitly cancelled by the user.</td></tr><tr><td><code>coming</code></td><td>The transfer is confirmed but the operation is still marked as coming.</td></tr><tr><td><code>deleted</code></td><td>The transfer was not found on the bank.</td></tr><tr><td><code>transactionNotFound</code></td><td>The transfer has been confirmed but the matching transaction is not found on the bank.</td></tr><tr><td><code>wrongpass</code></td><td>The authentication on the website has failed.</td></tr><tr><td><code>additionalInformationNeeded</code></td><td>Additional information is needed such as an OTP.</td></tr><tr><td><code>websiteUnavailable</code></td><td>The connector website is unavailable.</td></tr><tr><td><code>actionNeeded</code></td><td>An action is needed on the website by the user, scraping is blocked.</td></tr><tr><td><code>decoupled</code></td><td>Requires a user validation on a third-party app or device (ex: digital key).</td></tr><tr><td><code>bug</code></td><td>A bug has occurred during the synchronization.</td></tr></tbody></table>

### ***TransferValidateMechanism*****&#x20;values**

<table><thead><tr><th width="179">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>credentials</code></td><td>The transfer will be validated using a set of <code>fields</code> available in the API response.</td></tr><tr><td><code>webauth</code></td><td>The transfer will be validated using the <code>/webauth</code> endpoint.</td></tr></tbody></table>

### *TransfersList* object

<table><thead><tr><th width="205.33333333333331">Property</th><th width="161">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>transfers</code></td><td>Array of <a href="#transfer-object"><em>Transfer</em></a> objects</td><td>List of transfers. The list only includes transfers created by our API.</td></tr><tr><td><code>first_date</code></td><td>Date</td><td>Minimum available date for results.</td></tr><tr><td><code>last_date</code></td><td>Date</td><td>Maximum available date for results.</td></tr><tr><td><code>result_min_date</code></td><td>Date</td><td>Minimum date of results in the current response.</td></tr><tr><td><code>result_max_date</code></td><td>Date</td><td>Maximum date of results in the current response.</td></tr></tbody></table>

### ***TransferUpdateRequest*****&#x20;object**

<table><thead><tr><th>Name</th><th width="167">Type</th><th width="94">Required</th><th>Description</th></tr></thead><tbody><tr><td><code>id_account</code></td><td>Integer</td><td>No</td><td>New ID of the emitter account.</td></tr><tr><td><code>amount</code></td><td>Decimal</td><td>No</td><td>New transfer amount. The currency is set by the emitter account.</td></tr><tr><td><code>label</code></td><td>String</td><td>No</td><td>New label of the transfer.</td></tr><tr><td><code>beneficiary_type</code></td><td><a href="#beneficiarytype-values"><em>BeneficiaryType</em></a> string</td><td>No</td><td>New type of beneficiary.</td></tr><tr><td><code>id_recipient</code></td><td>Integer</td><td>No</td><td>New ID of the recipient, for the <code>recipient</code> beneficiary type.</td></tr><tr><td><code>beneficiary_number</code></td><td>String</td><td>No</td><td>New identification of the beneficiary, according to the <code>beneficiary_type</code>: IBAN or phone number.</td></tr><tr><td><code>beneficiary_label</code></td><td>String</td><td>No</td><td>New name of the beneficiary for the <code>iban</code> or <code>phone_number</code> types.</td></tr><tr><td><code>validated</code></td><td>Boolean</td><td>No</td><td>Flag to validate the transfer (submit to the bank).</td></tr></tbody></table>

To validate a transfer using the [`credentials` mechanism](#transfervalidatemechanism-values), you must include in the request the values from the [connector `fields`](/api-reference/user-connections/connectors.md#connector-object).


