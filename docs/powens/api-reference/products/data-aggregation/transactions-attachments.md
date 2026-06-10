# Transactions attachments

{% hint style="warning" %}
This feature is not activated by default on your domain. Please contact us to request access.&#x20;
{% endhint %}

Upon activation, the property `attachments` is available in the [Bank transactions](/api-reference/products/data-aggregation/bank-transactions.md).

## API endpoint

## List attachments.

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/transactions?expand=attachments`

List attachments for transactions.&#x20;

#### Path Parameters

| Name                                     | Type            | Description             |
| ---------------------------------------- | --------------- | ----------------------- |
| userId<mark style="color:red;">\*</mark> | Integer or "me" | ID of the related user. |

#### Query Parameters

| Name                                          | Type    | Description                                                  |
| --------------------------------------------- | ------- | ------------------------------------------------------------ |
| limit<mark style="color:red;">\*</mark>       | Integer | Number of transactions to return. The maximum value is 1000. |
| attachments<mark style="color:red;">\*</mark> | String  | Attachments related to the transactions                      |

{% tabs %}
{% tab title="200: OK List of transactions" %}
Response body: [#transactionslist-object](#transactionslist-object "mention")
{% endtab %}
{% endtabs %}

## Get a bank transaction and its attachment.

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/transactions/{transactionId}/attachments`

Get a single bank transaction by ID, and its attachment.

#### Path Parameters

| Name                                            | Type            | Description              |
| ----------------------------------------------- | --------------- | ------------------------ |
| userId<mark style="color:red;">\*</mark>        | Integer or "me" | ID for the related user. |
| transactionId<mark style="color:red;">\*</mark> | Integer         | ID of the transaction.   |

{% tabs %}
{% tab title="200: OK Transaction" %}
Response body: [#transaction-object](#transaction-object "mention")
{% endtab %}
{% endtabs %}

### ***Attachment*****&#x20;object**&#x20;

| Property           | Type     | Description                                                                                                                                                                   |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | Integer  | ID of the attachment.                                                                                                                                                         |
| `name`             | String   | Name of the attachment.                                                                                                                                                       |
| `description`      | String   | A text description that provides additional information about the file. This field can be used to describe the content, purpose, or any relevant details related to the file. |
| `mime_type`        | String   | Media type of the attachment (A media type is a two-part identifier for file formats and format contents transmitted on the Internet.)                                        |
| `size`             | Integer  | Size of the attachment in bytes.                                                                                                                                              |
| `created_date`     | Date     | Date when the attachment was created.                                                                                                                                         |
| `created_datetime` | DateTime | Date and time when the attachment was created.                                                                                                                                |
| `last_update`      | DateTime | Datetime of the last synchronization of the attachment.                                                                                                                       |
| `url`              | String   | The url to retrieve the attachment.                                                                                                                                           |

## Webhook

### Attachment found

A `TRANSACTION_ATTACHMENTS_FOUND` webhook is emitted during a sync after bank accounts have been synchronized, and after the transactions are processed.

Webhook request:

<table><thead><tr><th width="235">Property</th><th width="263">Type</th><th width="250">Description</th></tr></thead><tbody><tr><td><code>id_connection</code></td><td>Integer</td><td>ID of the connection.</td></tr><tr><td><code>id_account</code></td><td>Integer</td><td>ID of the account.</td></tr><tr><td><code>id_transaction</code></td><td>Integer</td><td>ID of the transaction.</td></tr><tr><td><code>attachments</code></td><td>List of <a href="/pages/FmNMlfgHBosSWbMOIJjv#attachment-object">AttachmentObject</a></td><td>Array of attachments of a transaction.</td></tr></tbody></table>


