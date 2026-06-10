# Check

### Check data <a href="#banking-data" id="banking-data"></a>

The Check product exposes account ownerships.

<figure><img src="/files/Zfx5ULi1U9Df1cOaksm2" alt=""><figcaption></figcaption></figure>

#### Check account <a href="#bank-accounts" id="bank-accounts"></a>

We provide a view of the bank account of a user with [/account\_ownerships endpoint](https://docs.powens.com/api-reference/products/banking-aggregation/account-ownerships):

```
GET /users/me/account_ownerships
GET /users/me/connections/{connectionId}/account_ownerships
```

```json
{
  "account_ownerships": [
    {
      "id_account": 12345,
      "id_connection": 1234,
      "id_user": 123,
      "id_connector_source": 1234,
      "name": "Compte de dépôt",
      "usage": "PRIV",
      "bank_name": "Bank",
      "multiple_holders": "null",
      "calculated": [],
      "parties": [
        {
          "role": "holder",
          "identity": {
            "is_user": true,
            "full_name": "DOE John"
          }
        },
        ...
      ],
      "identifications": [
        {
          "scheme_name": "iban",
          "identification": "FR1221954549412158521"
        },
        ...
      ]
    }
  ],
  "total": 1
}
```

Check account is linked to a *connection* (they are deleted with the connection).


