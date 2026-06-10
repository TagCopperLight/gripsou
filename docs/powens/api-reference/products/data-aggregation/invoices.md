# Invoices

## API endpoints <a href="#list-transactions" id="list-transactions"></a>

{% hint style="success" %}
Authentication: endpoints listed in this page *require* [header authentication](/api-reference/overview/authentication.md) with a *user token*.
{% endhint %}

## List invoices

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/invoices`

#### Path Parameters

| Name                                     | Type            | Description             |
| ---------------------------------------- | --------------- | ----------------------- |
| userId<mark style="color:red;">\*</mark> | Integer or "me" | ID of the related user. |

#### Query Parameters

| Name                                    | Type       | Description                                             |
| --------------------------------------- | ---------- | ------------------------------------------------------- |
| all                                     | Value-less | Flag to include deleted invoices.                       |
| limit<mark style="color:red;">\*</mark> | Integer    | Number of invoices to return. The maximum value is 100. |

{% tabs %}
{% tab title="200: OK List of invoices" %}
Response body: [#invoiceslist-object](#invoiceslist-object "mention")
{% endtab %}

{% tab title="200: No invoices" %}
Response body: empty list
{% endtab %}
{% endtabs %}

{% code title="Route aliases" %}

```
/users/{userId}/invoices
/users/{userId}/connections/{connectionId}/invoices
```

{% endcode %}

## Get an invoice

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/invoices/{invoiceId}`

Get a single invoice by ID.

#### Path Parameters

| Name                                        | Type            | Description              |
| ------------------------------------------- | --------------- | ------------------------ |
| userId<mark style="color:red;">\*</mark>    | Integer or "me" | ID for the related user. |
| invoiceId<mark style="color:red;">\*</mark> | Integer         | ID of the invoice.       |

{% tabs %}
{% tab title="200: OK Transaction" %}
Response body: [#invoice-object](#invoice-object "mention")
{% endtab %}
{% endtabs %}

## Data model

### ***InvoicesList*****&#x20;object**

<table><thead><tr><th width="214">Property</th><th width="220.33333333333331">Type</th><th width="309.6666666666667">Description</th></tr></thead><tbody><tr><td><code>invoices</code></td><td>Array of <a href="#get-an-invoice"><em>Invoice</em></a> objects</td><td>List of invoices.</td></tr></tbody></table>

### ***Invoice*****&#x20;object**

| Property                                 | Type                                                                                                                        | Description                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `id`                                     | Integer                                                                                                                     | ID of the invoice.                                    |
| `id_user`                                | Integer                                                                                                                     | ID of the related user.                               |
| `id_connection`                          | Integer                                                                                                                     | ID of the related connection.                         |
| `id_connection_source`                   | Integer                                                                                                                     | ID of the related connection source.                  |
| `number`                                 | String                                                                                                                      | Invoice number.                                       |
| `description`                            | String or null                                                                                                              | Description of the invoice.                           |
| `status`                                 | [#status-values](#status-values "mention")                                                                                  | Status of invoice.                                    |
| `items`                                  | Array of [#items-object](#items-object "mention")                                                                           | Items of the invoice. If no items, the list is empty. |
| `customer`                               | [#customer-object](#customer-object "mention")                                                                              | Customer of the invoice.                              |
| `invoicer`                               | [#invoicer-object](#invoicer-object "mention")                                                                              | Invoicer of the invoice.                              |
| `total_amount`                           | [#invoiceamount-object](#invoiceamount-object "mention")                                                                    | Total amount of the invoice.                          |
| `total_amount_exclusing_tax`             | [#invoiceamount-object](#invoiceamount-object "mention")                                                                    | Total amount excluding the tax of the invoice.        |
| `total_tax_amount`                       | [#invoiceamount-object](#invoiceamount-object "mention")                                                                    | Total tax amount of the invoice.                      |
| `total_discount_amount`                  | [#invoiceamount-object](#invoiceamount-object "mention")                                                                    | Total discount amount of the invoice.                 |
| `paid_amount`                            | Decimal or null                                                                                                             | Paid amount of the invoice.                           |
| `remaining_amount`                       | Decimal or null                                                                                                             | Remaining amount of the invoice.                      |
| `shipping_amount`                        | Decimal or null                                                                                                             | Shipping amount of the invoice.                       |
| `total_pre_payment_credit_notes_amount`  | Decimal or null                                                                                                             | Credit note amount applied before the payment.        |
| `total_post_payment_credit_notes_amount` | Decimal or null                                                                                                             | Credit note amount applied after the payment.         |
| `last_update`                            | DateTime                                                                                                                    | Last successful update of the invoice.                |
| `scraped_date`                           | DateTime                                                                                                                    | Date and time when the invoice was retrieved.         |
| `created`                                | DateTime or null                                                                                                            | Date when the invoice was created.                    |
| `issue_date`                             | DateTime or null                                                                                                            | Issue date of the invoice.                            |
| `due_date`                               | DateTime or null                                                                                                            | Due date of the invoice.                              |
| `fully_paid_date`                        | DateTime or null                                                                                                            | Fully paid date of the invoice.                       |
| `deleted`                                | DateTime or null                                                                                                            | Deleted date.                                         |
| `attachments`                            | Array of [Transactions attachments](/api-reference/products/data-aggregation/transactions-attachments.md#attachment-object) | Invoice's attachment. Can be the original invoice.    |

### ***Status*****&#x20;values**

<table><thead><tr><th width="238">Property</th><th width="309.6666666666667">Description</th></tr></thead><tbody><tr><td><code>open</code></td><td>Invoice is still open.</td></tr><tr><td><code>paid</code></td><td>Invoice is paid.</td></tr><tr><td><code>partially_paid</code></td><td>Invoice is partially paid.</td></tr><tr><td><code>draft</code></td><td>Invoice is in draft.</td></tr><tr><td><code>cancelled</code></td><td>Invoice is cancelled.</td></tr><tr><td><code>pending</code></td><td>Invoice is waiting its payment.</td></tr><tr><td><code>uncollectible</code></td><td>Invoice is uncollectible.</td></tr><tr><td><code>refunded</code></td><td>Invoice is refunded.</td></tr><tr><td><code>partially_refunded</code></td><td>Invoice is partially refunded.</td></tr></tbody></table>

### *Items* object

<table><thead><tr><th width="268">Property</th><th width="244.66666666666669">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>title</code></td><td>String or null</td><td>Title of the item.</td></tr><tr><td><code>description</code></td><td>String or null</td><td>Description of the item.</td></tr><tr><td><code>quantity</code></td><td>Integer </td><td>Quantity of item.</td></tr><tr><td><code>total_amount</code></td><td><a data-mention href="#invoiceamount-object">#invoiceamount-object</a></td><td>Total amount of the item.</td></tr><tr><td><code>unit_price</code></td><td><a data-mention href="#invoiceamount-object">#invoiceamount-object</a></td><td>Unit price of the item.</td></tr><tr><td><code>taxes</code></td><td>Array of <a data-mention href="#taxes-object">#taxes-object</a> or null</td><td>Taxes of the item.</td></tr><tr><td><code>discounts</code></td><td>Array of <a data-mention href="#discount-object">#discount-object</a> or null</td><td>Discounts of the item.</td></tr><tr><td><code>total_amount_excluding_tax</code></td><td><a data-mention href="#invoiceamount-object">#invoiceamount-object</a></td><td>Total amount of the item excluding the taxes.</td></tr><tr><td><code>total_tax_amount</code></td><td><a data-mention href="#invoiceamount-object">#invoiceamount-object</a></td><td>Total tax amount of the item.</td></tr><tr><td><code>total_discount_amount</code></td><td><a data-mention href="#invoiceamount-object">#invoiceamount-object</a></td><td>Total discount amount of the item.</td></tr></tbody></table>

### *InvoiceAmount* object

<table><thead><tr><th width="214">Property</th><th width="309.6666666666667">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>currency</code></td><td>String</td><td>ID of the currency (<a href="https://en.wikipedia.org/wiki/ISO_4217">ISO 4217 code</a>).</td></tr><tr><td><code>value</code></td><td>Decimal or null</td><td>Value.</td></tr></tbody></table>

### *Taxes* object

<table><thead><tr><th width="214">Property</th><th width="309.6666666666667">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>currency</code></td><td>String</td><td>ID of the currency (<a href="https://en.wikipedia.org/wiki/ISO_4217">ISO 4217 code</a>).</td></tr><tr><td><code>value</code></td><td>Decimal or null</td><td>Value.</td></tr><tr><td><code>description</code></td><td>String or null</td><td>Description of the tax.</td></tr><tr><td><code>country</code></td><td>String or null</td><td>Country of the tax.</td></tr><tr><td><code>tax_type</code></td><td><a data-mention href="#taxtype-values">#taxtype-values</a></td><td>Tax type.</td></tr><tr><td><code>percentage</code></td><td>Integer or null</td><td>Percentage of the tax.</td></tr><tr><td><code>taxable_amount</code></td><td>Integer or null</td><td>Taxable amount.</td></tr></tbody></table>

### ***TaxType*****&#x20;values**

<table><thead><tr><th width="214">Property</th><th>Description</th></tr></thead><tbody><tr><td><code>amusement</code></td><td>Tax related to entertainment or leisure activities.</td></tr><tr><td><code>communications</code></td><td>Tax applied to communication services.</td></tr><tr><td><code>gst</code></td><td>Goods and services tax.</td></tr><tr><td><code>hst</code></td><td>Harmonized sales tax.</td></tr><tr><td><code>igst</code></td><td>Integrated goods and services tax (applied in India).</td></tr><tr><td><code>jct</code></td><td>Japan consumption tax.</td></tr><tr><td><code>lease</code></td><td>Tax related to leasing agreements.</td></tr><tr><td><code>pst</code></td><td>Provincial sales tax.</td></tr><tr><td><code>qst</code></td><td>Quebec sales tax.</td></tr><tr><td><code>rst</code></td><td>Retail sales tax.</td></tr><tr><td><code>sales</code></td><td>General term for tax applied to the sale of goods or services.</td></tr><tr><td><code>service</code></td><td>Tax applied specifically to services provided.</td></tr><tr><td><code>vat</code></td><td>Value added tax, a consumption tax at each stage of the supply chain.</td></tr><tr><td><code>unknown</code></td><td>unknow tax.</td></tr></tbody></table>

### *Discount* object

<table><thead><tr><th width="214">Property</th><th width="309.6666666666667">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>amount</code></td><td><a data-mention href="#invoiceamount-object">#invoiceamount-object</a></td><td>Amount of the discount.</td></tr><tr><td><code>discount_type</code></td><td><a data-mention href="#discounttype-values">#discounttype-values</a></td><td>Discount type.</td></tr><tr><td><code>value</code></td><td>Decimal or null</td><td>Value of the discount type.</td></tr></tbody></table>

### ***DiscountType*****&#x20;values**

<table><thead><tr><th width="200">Property</th><th>Description</th></tr></thead><tbody><tr><td>percentage</td><td>Discount type value is a percentage.</td></tr><tr><td>absolute</td><td>Discount type value is absolute.</td></tr></tbody></table>

### *Customer* object

<table><thead><tr><th width="214">Property</th><th width="243.66666666666669">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>full_name</code></td><td>String or null</td><td>Full name of the customer.</td></tr><tr><td><code>first_name</code></td><td>String or null</td><td>First name of the customer.</td></tr><tr><td><code>last_name</code></td><td>String or null</td><td>Last name of the customer.</td></tr><tr><td><code>phone</code></td><td>String or null</td><td>Phone number of the customer.</td></tr><tr><td><code>email</code></td><td>String or null</td><td>Email of the user.</td></tr><tr><td><code>type</code></td><td><a data-mention href="#customertype-values">#customertype-values</a></td><td>Customer type.</td></tr><tr><td><code>shipping_address</code></td><td><a data-mention href="#customershippingaddress-object">#customershippingaddress-object</a></td><td>Shipping address of the customer.</td></tr><tr><td><code>billing_address</code></td><td><a data-mention href="#customerbillingaddress-object">#customerbillingaddress-object</a></td><td>Billing address of the customer.</td></tr></tbody></table>

### ***CustomerType*****&#x20;values**

<table><thead><tr><th width="214">Property</th><th width="309.6666666666667">Description</th></tr></thead><tbody><tr><td><code>company</code></td><td>Company customer.</td></tr><tr><td><code>individual</code></td><td>Individual customer.</td></tr><tr><td><code>unknown</code></td><td>Unknown customer.</td></tr></tbody></table>

### *CustomerShippingAddress* object

<table><thead><tr><th width="214">Property</th><th width="201.66666666666669">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>street</code></td><td>String or null</td><td>Street name.</td></tr><tr><td><code>postal_code</code></td><td>String or null</td><td>Postal code.</td></tr><tr><td><code>city</code></td><td>String or null</td><td>City.</td></tr><tr><td><code>country_code</code></td><td>String or null</td><td>Country code (<a href="https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2">ISO 3166-1 alpha-2 codes</a>).</td></tr><tr><td><code>full_address</code></td><td>String or null</td><td>Customer shipping address.</td></tr><tr><td><code>name</code></td><td>String or null</td><td>Customer name of the shipping address.</td></tr><tr><td><code>phone</code></td><td>String or null</td><td>Phone number of the customer.</td></tr></tbody></table>

### *CustomerBillingAddress* object

<table><thead><tr><th width="214">Property</th><th width="201.66666666666669">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>street</code></td><td>String or null</td><td>Street name.</td></tr><tr><td><code>postal_code</code></td><td>String or null</td><td>Postal code.</td></tr><tr><td><code>city</code></td><td>String or null</td><td>City.</td></tr><tr><td><code>country_code</code></td><td>String or null</td><td>Country code (<a href="https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2">ISO 3166-1 alpha-2 codes</a>).</td></tr><tr><td><code>full_address</code></td><td>String or null</td><td>Customer billing address.</td></tr></tbody></table>

### *Invoicer* object

<table><thead><tr><th width="214">Property</th><th width="228.66666666666669">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td>String or null</td><td>Name of the invoicer.</td></tr><tr><td><code>phone</code></td><td>String or null</td><td>Phone of the invoicer.</td></tr><tr><td><code>email</code></td><td>String or null</td><td>Email of the invoicer.</td></tr><tr><td><code>siren</code></td><td>String or null</td><td>Siren of the invoicer.</td></tr><tr><td><code>activity_area</code></td><td>String or null</td><td>Activity area of the invoicer.</td></tr><tr><td><code>address</code></td><td><a data-mention href="#invoicershippingaddress-object">#invoicershippingaddress-object</a></td><td>Invoicer shipping address.</td></tr></tbody></table>

### *InvoicerShippingAddress* object

<table><thead><tr><th width="214">Property</th><th width="170.66666666666669">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>street</code></td><td>String or null</td><td>Street name.</td></tr><tr><td><code>postal_code</code></td><td>String or null</td><td>Postal code.</td></tr><tr><td><code>city</code></td><td>String or null</td><td>City.</td></tr><tr><td><code>country_code</code></td><td>String or null</td><td>Country code (<a href="https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2">ISO 3166-1 alpha-2 codes</a>).</td></tr><tr><td><code>full_address</code></td><td>String or null</td><td>Invoicer address.</td></tr></tbody></table>


