# Trust

This section guides you on how to interact with our API to access bills and various documents of your users. You must have followed the steps in “[Add a first user and connection](/documentation/integration-guides/quick-start/add-a-first-user-and-connection.md)” section.

### Billing data <a href="#billing-data" id="billing-data"></a>

The Trust product exposes subscriptions and documents.

<figure><img src="/files/caypTiy4kEA6EAMR2Zif" alt=""><figcaption></figcaption></figure>

A "subscription" is a document container or group. The purpose may vary by connector, for example to isolate documents linked to a contract. When it is not relevant for a connector, we still simulate a single subscription matching the user account using profile information if available. For bank websites where we can return a RIB and statement documents, we create one subscription per bank account.

#### Subscriptions <a href="#subscriptions" id="subscriptions"></a>

We provide a view to the subscriptions of a user with [`/subscriptions` endpoints](https://docs.powens.com/api-reference/products/documents-aggregation/subscriptions):

```
GET /users/me/subscriptions
GET /users/me/connections/{connectionId}/subscriptions
```

```json
{
  "subscriptions": [
    {
      "id": 12345,
      "label": "Contrat EZ4225",
      "number": "EZ42250022314",
      "subscriber": "Mr John Doe",
      …
    },
    …
  ]
}
```

Subscriptions are linked to a *connection* (they are deleted with the connection).

{% hint style="info" %} <mark style="color:blue;">The subscriptions list reflect the set of subscriptions found when synchronizing with a provider, using a safe archiving rule:</mark>

* when a new subscription is discovered, it is added;
* when a subscription is no more found, it is marked with a [`deleted` flag](https://docs.powens.com/api-reference/products/documents-aggregation/subscriptions#get-a-subscription) and is not listed by default, but it can still be accessed by its ID or with the [`?all` parameter](https://docs.powens.com/api-reference/products/documents-aggregation/subscriptions#list-subscriptions).
  {% endhint %}

#### Documents <a href="#documents" id="documents"></a>

We provide a view to the set of documents of a user with [`/documents` endpoints](https://docs.powens.com/api-reference/products/documents-aggregation/documents):

```
GET /users/me/documents
GET /users/me/subscriptions/{subscriptionId}/documents
```

```json
{
  "documents": [
    {
      "id": 56789,
      "name": "Facture Acme 023315",
      "type": "bill",
      "rdate": "2020-08-27",
      "url": "https://…",
      "thumb_url": "https://…",
      …
    },
    …
  ],
  "first_date": "2017-02-14",
  "last_date": "2020-09-15",
  "result_min_date": "2020-08-30",
  "result_max_date": "2020-09-30"
}
```

Documents are linked to a *subscription* (they are deleted with the subscription).

We provide access to raw files of documents with the `url` property, when such files are available on the website.\
The file format depends on the connector: most websites provide PDF files, if they don't we expose HTML files.

{% hint style="info" %}
You can enable the `force_pdf` [configuration key](https://docs.powens.com/api-reference/api-setup/configuration) in your API to always generate a PDF version of files.\
Please note that this configuration takes effect on synchronization only and is not retroactive: any change will only apply to newly-discovered documents.
{% endhint %}

### Captcha <a href="#captcha" id="captcha"></a>

Some websites ask for a captcha, especially for bills. Our system is able to resolve them for you automatically, but this feature is disabled by default. You can enable it by setting the `captcha.enabled` [configuration key](https://docs.powens.com/api-reference/api-setup/configuration) to 1. `captcha.enabled` is set to 0 by default.

If this key is disabled and the website requires captcha resolution, your connection will fall into the `websiteUnavailable` [state](https://docs.powens.com/api-reference/user-connections/connections#connectionstate-values). Our resolution system may fail to resolve a captcha for various reasons. As a result the connection would also fall into the `websiteUnavailable` [state](https://docs.powens.com/api-reference/user-connections/connections#connectionstate-values), but our background workers will automatically retry later.

We don’t provide a list of websites asking for a captcha since it is subject to change frequently.


