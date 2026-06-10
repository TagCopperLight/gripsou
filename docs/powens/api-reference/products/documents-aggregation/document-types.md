# Document types

## API endpoints

## List document types

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/documenttypes`

{% tabs %}
{% tab title="200: OK List of documents types" %}
Response body: [#documenttypeslist-object](#documenttypeslist-object "mention")
{% endtab %}
{% endtabs %}

## Data model

### *DocumentTypesList* object

| Property        | Type                                                    | Description             |
| --------------- | ------------------------------------------------------- | ----------------------- |
| `documenttypes` | Array of [*DocumentType*](#documenttype-values) strings | List of document types. |

### *DocumentType* values

| Value                           |
| ------------------------------- |
| `zimage`                        |
| `pdf`                           |
| `odt`                           |
| `bill`                          |
| `RIB`                           |
| `statement`                     |
| `contract`                      |
| `notice`                        |
| `report`                        |
| `other`                         |
| ~~`income_tax`~~ (*deprecated*) |
| `kiid`                          |
| `certificate`                   |
| `identity`                      |
| `payslip`                       |
| `exchange_statement`            |
| `bill_debit_advice`             |

{% hint style="info" %}
Forward compatibility requirement: additional types may be added in the future. When implementing type handling, always fallback to a generic case for unknown values.
{% endhint %}


