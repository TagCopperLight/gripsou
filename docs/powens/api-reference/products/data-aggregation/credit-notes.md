# Credit notes

## API endpoints <a href="#list-transactions" id="list-transactions"></a>

{% hint style="success" %}
Authentication: endpoints listed in this page *require* [header authentication](/api-reference/overview/authentication.md) with a *user token*.
{% endhint %}

## List credit notes

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/credit_notes`

#### Path Parameters

| Name                                     | Type            | Description             |
| ---------------------------------------- | --------------- | ----------------------- |
| userId<mark style="color:red;">\*</mark> | Integer or "me" | ID of the related user. |

#### Query Parameters

| Name                                    | Type       | Description                                                 |
| --------------------------------------- | ---------- | ----------------------------------------------------------- |
| all                                     | Value-less | Flag to include deleted credit notes.                       |
| limit<mark style="color:red;">\*</mark> | Integer    | Number of credit notes to return. The maximum value is 100. |

{% tabs %}
{% tab title="200: OK List of credit notes" %}
Response body: [#creditnoteslist-object](#creditnoteslist-object "mention")
{% endtab %}

{% tab title="200: No credit notes" %}
Response body: empty list
{% endtab %}
{% endtabs %}

{% code title="Route aliases" %}

```
/users/{userId}/credit_notes
/users/{userId}/connections/{connectionId}/credit_notes
/users/{userId}/invoices/{invoices_id}/credit_notes
```

{% endcode %}

## Get a credit note

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/credit_notes/{credit_notesId}`

Get a single credit note by ID.

#### Path Parameters

| Name                                              | Type            | Description              |
| ------------------------------------------------- | --------------- | ------------------------ |
| userId<mark style="color:red;">\*</mark>          | Integer or "me" | ID for the related user. |
| credit\_notesId<mark style="color:red;">\*</mark> | Integer         | ID of the credit note.   |

{% tabs %}
{% tab title="200: OK Transaction" %}
Response body: [#creditnote-object](#creditnote-object "mention")
{% endtab %}
{% endtabs %}

## Data model

### ***CreditNotesList*****&#x20;object**

<table><thead><tr><th width="214">Property</th><th width="220.33333333333331">Type</th><th width="309.6666666666667">Description</th></tr></thead><tbody><tr><td><code>credit_notes</code></td><td>Array of <a data-mention href="#creditnote-object">#creditnote-object</a> objects</td><td>List of credit notes.</td></tr></tbody></table>

### ***CreditNote*****&#x20;object**

| Property                      | Type                                                                                                      | Description                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `id`                          | Integer                                                                                                   | ID of the invoice.                                 |
| `id_user`                     | Integer                                                                                                   | ID of the related user.                            |
| `id_connection`               | Integer                                                                                                   | ID of the related connection.                      |
| `id_connection_source`        | Integer                                                                                                   | ID of the related connection source.               |
| `id_invoice`                  | Integer                                                                                                   | ID of the related invoice.                         |
| `number`                      | String                                                                                                    | Credit notes number.                               |
| `memo`                        | String or null                                                                                            | Memo of the credit note.                           |
| `issue_date`                  | DateTime or nuIl                                                                                          | Issue date of the credit note.                     |
| `created`                     | DateTime                                                                                                  | Creation date of the credit note.                  |
| `total_amount`                | [#creditnoteamount-object](#creditnoteamount-object "mention")                                            | Total amount of the credit note.                   |
| `total_amount_exclusing_tax`  | [#creditnoteamount-object](#creditnoteamount-object "mention")or null                                     | Total amount excluding the tax of the credit note. |
| `total_tax_amount`            | [#creditnoteamount-object](#creditnoteamount-object "mention")or null                                     | Total tax amount of the credit note.               |
| `total_discount_amount`       | [#creditnoteamount-object](#creditnoteamount-object "mention")or null                                     | Total discount amount of the invoice.              |
| `amount_paid_out_of_platform` | Integer or null                                                                                           |                                                    |
| `shipping_amount`             | [#creditnoteamount-object](#creditnoteamount-object "mention")                                            | Shipping amount of the credit note.                |
| `reason`                      | [#creditnotesreason-values](#creditnotesreason-values "mention")or null                                   | Reason of the credit note                          |
| `type`                        | [#creditnotestype-values](#creditnotestype-values "mention") or null                                      |                                                    |
| `status`                      | [#status-values](#status-values "mention") or null                                                        | Status of the credit note.                         |
| `scraped_date`                | DateTime                                                                                                  | Date and time when the invoice was retrieved.      |
| `attachments`                 | Array of [Transactions attachments](/api-reference/products/data-aggregation/transactions-attachments.md) | Original document.                                 |
| `last_update`                 | DateTime                                                                                                  | Last successful update of the credit note.         |
| `deleted`                     | DateTime or null                                                                                          | Deleted date.                                      |

### ***CreditNotesReason*****&#x20;values**

<table><thead><tr><th width="316">Property</th><th width="309.6666666666667">Description</th></tr></thead><tbody><tr><td><code>duplicate</code></td><td>Duplicate credit note.</td></tr><tr><td><code>fraudulent</code></td><td>Fraudulent.</td></tr><tr><td><code>order_change</code></td><td>Change of order.</td></tr><tr><td><code>product_unstatisfactory</code></td><td>Unsastifactory product.</td></tr><tr><td><code>unknown</code></td><td>Unknown.</td></tr></tbody></table>

### **CreditNotesType values**

<table><thead><tr><th width="238">Property</th><th width="402.6666666666667">Description</th></tr></thead><tbody><tr><td><code>pre_payment</code></td><td>The credit note was issued when the invoice was open.</td></tr><tr><td><code>post_payment</code></td><td>The credit note was issued when the invoice was paid.</td></tr></tbody></table>

### **CreditNotesStatus values**

<table><thead><tr><th width="238">Property</th><th width="401.6666666666667">Description</th></tr></thead><tbody><tr><td><code>void</code></td><td>The credit note is cancelled.</td></tr><tr><td><code>issued</code></td><td>The credit note is issued.</td></tr></tbody></table>

### *CreditNoteAmount* object

<table><thead><tr><th width="214">Property</th><th width="149.66666666666669">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>currency</code></td><td>String</td><td>ID of the currency (<a href="https://en.wikipedia.org/wiki/ISO_4217">ISO 4217 code</a>).</td></tr><tr><td><code>value</code></td><td>Decimal or null</td><td>Value.</td></tr></tbody></table>


