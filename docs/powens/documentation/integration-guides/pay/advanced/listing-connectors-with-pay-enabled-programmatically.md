# Listing connectors with Pay enabled programmatically

You can list enabled connectors with support for the Pay product on your domain by making an API call, which is mostly useful when getting the available connector list programatically. See below on how to make such a call.

In order to obtain such connectors programmatically from your domain, you can query the whole list and filter the results for connectors which `products` contains `"pay"`:

```
GET /connectors
```

```json
{
  "connectors": [
    {
      "id": 40,
      "name": "Connecteur de test",
      "products": [
        "bank",
        "pay",
        "wealth"
      ],
      "payment_settings": {
        "available_validate_mechanisms": [
          "webauth"
        ],
        "beneficiary_types": [
          "iban"
        ],
        "execution_date_types": [
          "first_open_day",
          "instant",
          "deferred"
        ],
        "execution_frequencies": [
          "two-monthly",
          "semiannually",
          "weekly",
          "yearly",
          "four-monthly",
          "daily",
          "quarterly",
          "biannual",
          "bimonthly",
          "two-weekly",
          "monthly"
        ],
        "maximum_number_of_instructions": 10,
        "providing_payer_account": "optional"
      },
      …
    },
    …
  ]
}
```

Connectors supporting the Pay product will define a `payment_settings` object, which present Pay constraints and features for this specific connectors. For more information on the format of this object, e.g. if you only want connectors that support instant payments, see [PaymentSettings](https://docs.powens.com/api-reference/user-connections/connectors#paymentsettings-object).


