# Advisory (obsolete)

### User advisory

We provide a specific endpoint to allow you to access advisory metrics computed on end users’ banking data:

```
GET /users/me/advisory
```

```json5
{
  "id_user": 701,
  "last_update": "2023-03-30 11:27:21",
  "currency": "EUR",
  "periods": [
    {
      "period": "2022_12",
      "transactions_count": 65,
      "id_accounts": [
        131,
        133
      ],
      "min_date": "2022-12-04",
      "max_date": "2022-12-31",
      "disposable_income": {
        "currency": "EUR",
        "value": "2120.00"
      },
      "net_savings": {
        "currency": "EUR",
        "value": "4034.00"
      },
      "events": [
        {
          "count": 0,
          "event": "unauthorized-overdraft"
        }
      ],
      "transaction_types": [
        {
          "type": "card",
          "count": 3,
          "expenses_count": 3,
          "expenses_total": {
            "currency": "EUR",
            "value": "-1234.68"
          },
          "incomes_count": 0,
          "incomes_total": {
            "currency": "EUR",
            "value": "0.00"
          },
          "total": {
            "currency": "EUR",
            "value": "-1234.68"
          }
        },
        {
          "type": "withdrawal",
          "count": 0,
          "expenses_count": 0,
          "expenses_total": {
            "currency": "EUR",
            "value": "0.00"
          },
          "incomes_count": 0,
          "incomes_total": {
            "currency": "EUR",
            "value": "0.00"
          },
          "total": {
            "currency": "EUR",
            "value": "0.00"
          }
        },
        ...
      ],
      "transaction_categories": [
        {
          "category": "revenue",
          "count": 1,
          "total": {
            "currency": "EUR",
            "value": "2900.00"
          }
        },
        {
          "category": "loans",
          "count": 0,
          "total": {
            "currency": "EUR",
            "value": "0.00"
          }
        },
        {
          "category": "housing",
          "count": 1,
          "total": {
            "currency": "EUR",
            "value": "-780.00"
          }
        },
        {
          "category": "household",
          "count": 0,
          "total": {
            "currency": "EUR",
            "value": "0.00"
          }
        }
      ]
    }
  ]
}
```

### Steps

1. Ask your Account Manager to activate the Advisory plugin.
2. [Add a first user and connection](https://docs.powens.com/documentation/integration-guides/quick-start/add-a-first-user-and-connection) or [synchronize an existing connection after Advisory plugin activation](https://docs.powens.com/documentation/integration-guides/sca-and-connection-states).
3. Call the endpoint.

{% hint style="info" %}
Synchronizations

The Advisory metrics are computed asynchronously after every user synchronization. As such, the advisory metrics may not be available for a few seconds after a user first synchronization; if so the route will return the following output:

```json
{
  "id_user": 701,
  "last_update": null,
  "currency": "EUR",
  "periods": []
}
```

We would then suggest that you query it again after a few seconds, after which the complete JSON response should appear.
{% endhint %}


