# Bank integration guide

This section guides you on how to interact with our API to access banking data of your users. You must have followed the steps in “[Add a first user and connection](/documentation/integration-guides/quick-start/add-a-first-user-and-connection.md)” section.

{% hint style="warning" %} <mark style="color:orange;">Our banking connectors are subject to the revised Payment Service Directive (PSD2) that requires a new user consent every 180 days to access the web banking platform or the bank's API. You must implement proper handling of SCA-related connection states (</mark><mark style="color:orange;">`SCARequired`</mark> <mark style="color:orange;"></mark><mark style="color:orange;">and</mark> <mark style="color:orange;"></mark><mark style="color:orange;">`webauthRequired`</mark><mark style="color:orange;">)</mark> [as explained in the dedicated guide](/documentation/integration-guides/sca-and-connection-states.md).
{% endhint %}

### Banking data <a href="#banking-data" id="banking-data"></a>

The Bank product exposes bank accounts and transactions.

<figure><img src="/files/s8wH3LCjZfdlMTaHn0SF" alt=""><figcaption></figcaption></figure>

#### Bank accounts <a href="#bank-accounts" id="bank-accounts"></a>

We provide a view to the bank accounts of a user with [`/accounts` endpoints](https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts):&#x20;

```sh
GET /users/me/accounts 
GET /users/me/connections/{connectionId}/accounts
```

```json
{
  "accounts": [
    {
      "id": 12345,
      "name": "Compte de dépôt",
      "number": "0212366548",
      "iban": "FR1221954549412158521",
      "type": "checking",
      "balance": 1452.56,
      "coming": null,
      "currency": { "id": "EUR", … },
      …
    },
    …
  ]
}
```

Bank accounts are linked to a *connection* (they are deleted with the connection).

{% hint style="info" %}
The accounts list reflect the set of accounts found when synchronizing with a bank, using a safe archiving rule:

* when a new bank account is discovered, it is added;
* when a bank account is no more found, it is marked with a [`deleted` flag](https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts#get-a-bank-account) and is not listed by default, but it can still be accessed by its ID or with the [`?all` parameter](https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts#list-bank-accounts).
  {% endhint %}

{% hint style="warning" %} <mark style="color:orange;">GDPR enforcement requires an explicit end-user approval before fully synchronizing a bank account. By defaut, bank accounts are</mark> <mark style="color:orange;"></mark><mark style="color:orange;">`disabled`</mark> <mark style="color:orange;"></mark><mark style="color:orange;">when discovered and have a very limited set of values available (name), and no transactions. The webview takes care of activating them, or you can build your own user-consent interface and</mark> [update the flag](https://docs.powens.com/api-reference/products/data-aggregation/bank-accounts#update-a-bank-account).
{% endhint %}

#### Transactions <a href="#transactions" id="transactions"></a>

We provide a view to the history of transactions of a user with [`/transactions` endpoints](https://docs.powens.com/api-reference/products/data-aggregation/bank-transactions), which are [paginated](https://docs.powens.com/api-reference#lists-pagination).

```
GET /users/me/transactions?limit={limit}
GET /users/me/accounts/{accountId}/transactions?limit={limit}
```

```json
{
  "transactions": [
    {
      "id": 56789,
      "wording": "Paiement facture Acme",
      "date": "2020-09-15",
      "rdate": "2020-09-16",
      "value": -56.78,
      "type": "card",
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

Transactions are linked to a *bank account* (they are deleted with the bank account).

### Advanced: Connection sources <a href="#advanced-connection-sources" id="advanced-connection-sources"></a>

Some banking connectors support connecting to the bank plateform both through their web interface and their PSD2-compliant API. While the *connection* resource exposes an abstraction above these two *sources* of data, we also support fine grained access to each source and expose the individual synchronization state of each source. Our Connect webview properly takes care of managing the sources, so handling them is optional when using it.

* You can get the list of the supported sources of a connector:

```http
GET /connectors?expand=sources
```

```json
{
  "connectors": [
    {
      "id": 1,
      "name": "Bank name",
      "sources": [
        {
          "name": "openapi",
          "priority": 1,
          "account_types": [ … ],
          "disabled": null
          …
        },
        {
          "name": "directaccess",
          "priority": 2,
          "account_types": [ … ],
          "disabled": null
          …
        }
      ],
      …
    },
    …
  ]
}
```

Make sure the `disabled` property of a source is null before interacting with it. Also, you must honor the `priority` order of sources when adding them sequentially.

* On a connection, you can access the specific `state` or `last_update` of a connection source:

```http
GET /users/me/connections?expand=sources
```

```json
{
  "connections": [
    {
      "id": 27,
      "last_update": "2019-09-07 16:09:40",
      "state": "SCARequired",
      "sources": [
        {
          "id": 45,
          "last_update": "2019-09-07 16:09:40",
          "state": "SCARequired",
          "source": {
            "name": "openapi",
            "priority": 1,
            …
          },
          …
        },
        {
          "id": 46,
          "state": null,
          "source": {
            "auth_mechanism": "credentials",
            "name": "directaccess",
            "priority": 2,
            …
          },
          …
        }
      ]
    }
  ]
}
```


