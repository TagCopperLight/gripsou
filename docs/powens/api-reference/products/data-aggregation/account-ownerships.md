# Account Ownerships

{% hint style="warning" %}
This feature is not activated by default on your domain. Please contact us to request access.&#x20;
{% endhint %}

## API endpoints

## List account ownerships

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{user_id}/account_ownerships`

List all account ownerships available in the API.

#### Path Parameters

| Name                                     | Type            | Description             |
| ---------------------------------------- | --------------- | ----------------------- |
| userId<mark style="color:red;">\*</mark> | Integer or "me" | ID of the related user. |

{% tabs %}
{% tab title="200: OK List of account ownerships" %}
Response body: [#accountownership-object](#accountownership-object "mention")
{% endtab %}
{% endtabs %}

## **Data model**

### *AccountOwnership* object

<table><thead><tr><th width="246.33333333333331">Property</th><th width="224">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>id_account</code></td><td>Integer</td><td>ID of the related bank account.</td></tr><tr><td><code>id_connection</code></td><td>Integer</td><td>ID of the related connection.</td></tr><tr><td><code>id_user</code></td><td>Integer</td><td>ID of the related user.</td></tr><tr><td><code>id_connector_source</code></td><td>Integer</td><td>Id of the related connector source.</td></tr><tr><td><code>name</code></td><td>String or null</td><td>The name of the bank account.</td></tr><tr><td><code>bank_name</code></td><td>String or null</td><td>The name of the bank.</td></tr><tr><td><code>multiple_holders</code></td><td>Boolean or null</td><td>Whether this account has multiple holders. It is null if it is not possible to determine it.</td></tr><tr><td><code>calculated</code></td><td>Array</td><td>List the properties of account ownerships which are calculated. The array is either empty or with the <code>multiple_holders</code> value when this property is calculated.</td></tr><tr><td><code>usage</code></td><td><a data-mention href="/pages/6ZTi4nFvuqvWCMNrWCTt#bankaccountusage-values">/pages/6ZTi4nFvuqvWCMNrWCTt#bankaccountusage-values</a></td><td>Usage of the bank account.</td></tr><tr><td><code>parties</code></td><td>Array of <a data-mention href="#accountparty-object">#accountparty-object</a></td><td>List of account parties.</td></tr><tr><td><code>identifications</code></td><td>Array of <a data-mention href="#accountidentifications-object">#accountidentifications-object</a></td><td>List of account identifications.</td></tr></tbody></table>

### ***AccountParty*****&#x20;object**

<table><thead><tr><th width="245.33333333333331">Property</th><th width="183">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>role</code></td><td><a data-mention href="#accountpartyrole-values">#accountpartyrole-values</a></td><td>Role of the party.</td></tr><tr><td><code>identity</code></td><td><a data-mention href="#identityparty-object">#identityparty-object</a></td><td>Identity of the party.</td></tr></tbody></table>

### ***IdentityParty*****&#x20;object**

<table><thead><tr><th width="242">Value</th><th width="188">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>is_user</code></td><td>Boolean or null</td><td>Whether this account party represents the PSU, holder of the connection. It is null when it is not possible to verify this relation.</td></tr><tr><td><code>full_name</code></td><td>String</td><td>Full name of the account party.</td></tr></tbody></table>

### ***AccountIdentifications object***

<table><thead><tr><th width="209">Property</th><th width="204">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>scheme_name</code></td><td><a href="https://docs.powens.com/api-reference/products/banking-aggregation/bank-transactions#accountschemename-values">AccountSchemeName</a></td><td>Name of the account scheme type.</td></tr><tr><td><code>identification</code></td><td>String</td><td>Identification number of the account.</td></tr></tbody></table>

### ***AccountPartyRole values***

<table><thead><tr><th width="245">Value</th><th>Description</th></tr></thead><tbody><tr><td><code>holder</code></td><td>Entity which is the holder of the account.</td></tr><tr><td><code>co_holder</code></td><td>Entity which shares with others the holding of the account.</td></tr><tr><td><code>attorney</code></td><td>Generic case of a person having a mandate to access the account data.</td></tr><tr><td><code>custodian_for_minor</code></td><td>Entity that holds shares/units on behalf of a legal minor.</td></tr><tr><td><code>legal_guardian</code></td><td>Entity that was appointed by a legal authority to act on behalf of a person judged to be incapacitated.</td></tr><tr><td><code>nominee</code></td><td>Entity named by the beneficial owner to act on its behalf.</td></tr><tr><td><code>successor_on_death</code></td><td>Deceased's estate, or successor.</td></tr><tr><td><code>trustee</code></td><td>Legal owner of the property.</td></tr><tr><td><code>unknown</code></td><td>Unknown party.</td></tr></tbody></table>

## Webhook

### Account Ownerships found

An `ACCOUNT_OWNERSHIPS_FOUND` webhook is emitted during a sync after a bank ownerships have been synchronized.

Webhook request:

<table><thead><tr><th width="235">Property</th><th width="263">Type</th><th width="250">Description</th></tr></thead><tbody><tr><td><code>account_ownerships</code></td><td><em>AccountOwnership</em> object</td><td>The account ownerships related to the sync.</td></tr></tbody></table>


