# Wealth

The Wealth product is an extension of the [Bank product](/documentation/integration-guides/bank.md). Beyond the collection of PSD2-compliant accounts, Wealth extends the scope to all other accounts (loans, savings accounts, market accounts, life insurances, retirement savings, company savings…).

Wealth also enables the collection of additional information on these accounts, such as the valuation, the valuation differential and the previous differential.

Finally, Wealth enables the retrieval of three additional resources of wealth accounts:

* [Investments](https://docs.powens.com/api-reference/products/wealth-aggregation/investments) (financial assets of the account)
* [Pockets](https://docs.powens.com/api-reference/products/wealth-aggregation/pockets) (free shares, for company savings accounts only)
* [Market orders](https://docs.powens.com/api-reference/products/wealth-aggregation/market-orders) (for market accounts & equity savings plans only)
* [Loan amortizations](#market-order-resource-1) (for loans accounts)

<figure><img src="/files/qv36CkPWG0nJKYgUAemP" alt=""><figcaption></figcaption></figure>

Wealth thus offers a complete view of the end-user's patrimonial assets.

### Account types <a href="#account-types" id="account-types"></a>

<table><thead><tr><th width="163">Type</th><th>Description</th></tr></thead><tbody><tr><td>Market</td><td>Share account to buy and sell market stocks and obligations, directly on financial markets (CAC40 companies, DAX, Nasdaq ...) as well as units of account on investment funds. It is not possible to invest on Euro funds with this type of account.</td></tr><tr><td>PEA</td><td>'Plan Épargne Actions', a regulated account to buy and sell stocks in the EU. It allows you to acquire and manage a portfolio of European companies shares. It is exempt from taxes under certain conditions.</td></tr><tr><td>Life insurance</td><td>One of the most common investment accounts. It comes in two parts: first part invested in one or more Euro funds, and a second part invested in unit-linked contracts (investment funds, SICAV, UCITS, SCPI…). The respective proportion of these two parts depends on the investor's profile.</td></tr><tr><td>Capitalization</td><td>A French specific fiscal envelope very close to a life insurance contract, also made of two parts. Unlike life insurance, it is not based on any risk coverage: it does not depend on the subscriber's lifetime and it can be inherited.</td></tr><tr><td>PER</td><td>Company or individual retirement plan account. It is a contract available since October 1st, 2019, under the 'PACTE' law. The PER (Individual Retirement Savings Plan), is a long-term savings envelope for any person (individual or self-employed) wishing to build up savings for their retirement.</td></tr><tr><td>PERP</td><td>Private individual retirement plan account. PERP (popular retirement savings plan) is long-term savings. It allows you to save during your working life and to have an annuity at retirement and a capital option. PERP will no longer be offered after October 1st, 2020 (replaced by PER).</td></tr><tr><td>PERCO</td><td>The PERCO (collective retirement savings plan) is a company retirement plan account. As of October 1st, 2020, the Perco can no longer be implemented in companies. The Perco can be transformed into a collective enterprise PER.</td></tr><tr><td>Madelin</td><td>The Madelin contract is an individual retirement savings product for self-employed and liberal professions. Payments are supervised and have tax benefits. As of October 1st, 2020, it will no longer be possible to subscribe to a new Madelin contract.</td></tr></tbody></table>

### Features activation <a href="#features-activation" id="features-activation"></a>

Wealth features can be activated by your Account Manager only. Basic activation includes:

* the collection of **additional information on wealth accounts** (valuation, valuation differential, previous differential…);
* the retrieval of **investments** on wealth accounts;
* the retrieval of **pockets** (free shares), specifically for company savings accounts.

As an optional feature, you can also enable the collection of [additional details](https://docs.powens.com/api-reference/products/wealth-aggregation/investments#get-an-investment) for investments when available, mainly for connectors specialized in employee and company savings accounts (PER, PEE, PERP, PERCO, Madelin…).

Finally, the collection of **market orders** can also be independently activated.

### Additional attributes for Wealth accounts <a href="#additional-attributes-for-wealth-accounts" id="additional-attributes-for-wealth-accounts"></a>

As mentioned above, activating the API enables the collection of additional information for wealth accounts.

| Property            | Description                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `valuation`         | Sum of the valuations of the investments of this account.                                     |
| `diff`              | Difference between the amount invested on the account and the current balance of the account. |
| `diff_percent`      | Ratio between the amount invested on the account and the current balance of the account.      |
| `prev_diff`         | `diff` value obtained during the previous synchronization of the account.                     |
| `prev_diff_percent` | `diff_percent` value obtained during the previous synchronization of the account.             |

These attributes appear in the usual routes used to query accounts:

```
GET /users/me/accounts
GET /users/me/connections/{connectionId}/accounts
```

### Investment resources <a href="#investment-resources" id="investment-resources"></a>

The [investments](https://docs.powens.com/api-reference/products/wealth-aggregation/investments) are the financial assets of a wealth account. They can be financial equities, actions, obligations, Euro funds, unit-linked contracts or even liquidities:

```
GET /users/me/investments
GET /users/me/accounts/{accountId}/investments
GET /users/me/connections/{connectionId}/investments
```

```json
{
  "prev_diff_percent": 0.0,
  "calculated": [
    "diff",
    "diff_percent",
    "prev_diff",
    "pref_diff_percent",
    "valuation"
  ],
  "prev_diff": 0,
  "diff": 364.156,
  "total": 1,
  "valuation": 1055575.41,
  "investments": [
    {
      "code_type": "ISIN",
      "prev_vdate": null,
      "original_valuation": null,
      "portfolio_share": 0.7,
      "code": "FR1234567891",
      "diff": -14.659,
      "last_update": "2020-08-06 15:37:46",
      "unitvalue": 150959.777,
      "id": 30,
      "original_unitprice": null,
      "id_account": 1234,
      "deleted": null,
      "detail": {
        "last_update": "2020-08-06 15:37:46",
        "srri": 5,
        "recommended_period": "6 months",
        "performance_1_year": 0.5973,
        "performance_3_years": 0.9333,
        "performance_5_years": 0.7025,
        "asset_category": "US Actions"
      },
      "label": "Example Investment Label",
      "source": "website",
      "description": "",
      "original_unitvalue": null,
      "original_currency": null,
      "original_diff": null,
      "id_type": 1,
      "valuation": 1055575.41,
      "id_security": 224,
      "vdate": "2020-08-06",
      "calculated": [
        "portfolio_share"
      ],
      "prev_diff": null,
      "quantity": 3.094,
      "unitprice": 150964.515,
      "diff_percent": 0.0
    }
  ]
}
```

It contains a list of attributes that are related to the account, as well as an `investments` key containing a list of the investments for this account. If the account does not have any investment or if the investments are not implemented for this account type, the API will return an empty list.

{% hint style="info" %} <mark style="color:blue;">The</mark> <mark style="color:blue;"></mark><mark style="color:blue;">`calculated`</mark> <mark style="color:blue;"></mark><mark style="color:blue;">key indicates the list of attributes that are calculated and not directly obtained from the bank (for example,</mark> <mark style="color:blue;"></mark><mark style="color:blue;">`valuation`</mark> <mark style="color:blue;"></mark><mark style="color:blue;">is the sum of scraped investments valuations for a given account).</mark>
{% endhint %}

#### Investment history <a href="#investment-history" id="investment-history"></a>

Even though the investment attributes are updated at each synchronization, the history of all unit values, original unit values, original currencies and valuation dates is saved and can be accessed via the API:

```
GET /users/me/investments/{investmentId}/history
```

```json
{
  "investmentvalues": [
    {
      "original_unitvalue": null,
      "original_currency": null,
      "vdate": "2020-08-04",
      "id_investment": 12345,
      "unitvalue": 148.13,
      "id": 50
    },
    {
      "original_unitvalue": null,
      "original_currency": null,
      "vdate": "2020-08-03",
      "id_investment": 12345,
      "unitvalue": 147.15,
      "id": 49
    }
  ],
  "total": 2
}
```

This information can be used to build graphs of the value of each investment from the first time this investment was collected until the most recent synchronization.

#### Unit value history <a href="#unit-value-history" id="unit-value-history"></a>

The history depth depends of the investment: for most investments the history depth is one month (which includes daily values), but for some investments only today's unit value is available. In any case, the unit values and their corresponding dates are collected an exposed as `vdate` / `unitvalue` couples in the API.

```
GET /users/me/investments/{investmentId}/security/history
```

```json
{
  "history": [
    {
      "unitvalue": 192.86,
      "vdate": "2020-08-05"
    },
    {
      "unitvalue": 192.21,
      "vdate": "2020-08-04"
    },
    {
      "unitvalue": 192.13,
      "vdate": "2020-08-03"
    },
    {
      "unitvalue": 191.94,
      "vdate": "2020-07-31"
    }
  ],
  "result_min_date": "2020-07-31",
  "result_max_date": "2020-08-06",
  "first_date": "2020-07-31",
  "last_date": "2020-08-05",
}
```

This history of investment values can be used to build graphs of the evolution of the unit value of each stock from the first time we collected this information until today.

{% hint style="info" %} <mark style="color:blue;">This service is partly redundant with the history of a single investment (</mark><mark style="color:blue;">`/investments/{investmentId}/history`</mark> <mark style="color:blue;"></mark><mark style="color:blue;">route), both can be used and have their specificities and advantages. The security history route is common to all investments with the same ISIN, thus the history depth is usually bigger, however the data comes from the Boursorama website therefore there might be discrepancies between the unit values collected there and the actual unit values collected from the customer's website. In addition, the investment history route also contains the original unit values and currencies, when applicable.</mark>
{% endhint %}

### Pocket resource <a href="#pocket-resource" id="pocket-resource"></a>

Major companies and corporations sometimes give a part of their own stocks to their employees without any financial requirement. These freely given stocks are called **Pockets** or **Free shares** and can be found on connectors specialized in employee savings accounts (for example BNP, Natixis and Amundi).

On these employee savings accounts, Investments are often divided into several [Pockets](https://docs.powens.com/api-reference/products/wealth-aggregation/pockets) that have different **availability dates and conditions**. The most common availability condition is the retirement of the employee, but it can also be at a specific date in the future (for example 5 years after the Pocket was issued), in which case the Pocket will have an **availability date**. If the availability date is in the past, the Pocket is already available, hence the displayed condition will be `available`.

```
GET /users/me/investments/{investmentId}/pockets
GET /users/me/accounts/{accountId}/pockets
GET /users/me/connections/{connectionId}/pockets
```

```json
{
  "pockets": [
    {
      "deleted": null,
      "id_account": 1234,
      "id_investment": 12345,
      "value": 959.4602465,
      "label": "Unités de compte sous allocation libre",
      "availability_date": "2019-08-18",
      "last_update": "2020-08-18 16:13:36",
      "id": 61,
      "condition": "available",
      "quantity": 1.0705
    },
    {
      "deleted": null,
      "id_account": 1234,
      "id_investment": 12345,
      "value": 2576.0678566,
      "label": "Unités de compte sous allocation pilotée",
      "availability_date": "2022-08-18",
      "last_update": "2020-08-18 16:13:36",
      "id": 62,
      "condition": "retirement",
      "quantity": 2.8742
    },
    {
      "deleted": null,
      "id_account": 1234,
      "id_investment": 12345,
      "value": 1269.3914499,
      "label": "Actions Europe",
      "availability_date": "2023-08-18",
      "last_update": "2020-08-18 16:13:36",
      "id": 63,
      "condition": "date",
      "quantity": 1.4163
    }
  ]
}
```

### Market Order resource <a href="#market-order-resource" id="market-order-resource"></a>

**Market Orders** correspond to the purchases and sales of financial equities, actions and obligations on **Market accounts** and **Equity savings plans** (PEA). The collection of Market Orders provides an overview of the history of financial movements on these accounts. [Market Orders](https://docs.powens.com/api-reference/products/wealth-aggregation/market-orders) are currently implemented on most major bank connectors (Crédit Agricole, Caisse d'épargne, BNP Paribas, Société Générale, Boursorama, Fortuneo…), as well as websites specialized in stock exchange, such as online brokers (Binck, Degiro, Boursedirect...).

```
GET /users/me/accounts/{accountId}/marketorders
GET /users/me/connections/{connectionId}/marketorders
GET /users/me/marketorders
```

```json
{
  "marketorders": [
    {
      "code": "FR0000031122",
      "order_type": {
        "id": 2,
        "name": "MARKET"
      },
      "created": "2020-08-06 15:37:47",
      "payment_method": "UNKNOWN",
      "id_account": 1234,
      "order_direction": {
        "id": 3,
        "name": "SALE"
      },
      "execution_date": null,
      "webid": "X12548786",
      "amount": null,
      "label": "AIR FRANCE-KLM",
      "stock_market": "Xetra",
      "state": "Pending",
      "deleted": null,
      "ordervalue": null,
      "date": "2020-08-15 00:00:00",
      "validity_date": "2020-11-15 00:00:00",
      "unitvalue": null,
      "last_update": "2020-08-18 16:13:36",
      "unitprice": null,
      "id": 1,
      "quantity": 400.0
    },
    {
      "code": "US0231351067",
      "order_type": {
        "id": 3,
        "name": "LIMIT"
      },
      "created": "2020-08-06 15:37:47",
      "payment_method": "DEFERRED",
      "id_account": 1234,
      "order_direction": {
        "id": 2,
        "name": "BUY"
      },
      "execution_date": "2020-08-15 00:00:00",
      "webid": "ER1218443",
      "amount": 45400.02,
      "label": "AMAZON",
      "stock_market": "NASDAQ",
      "state": "Executed",
      "deleted": null,
      "ordervalue": 43.12,
      "date": "2020-08-12 00:00:00",
      "validity_date": "2020-11-12 00:00:00",
      "unitvalue": 45.38,
      "last_update": "2020-08-18 16:13:36",
      "unitprice": 45.41,
      "id": 2,
      "quantity": 1000.0
    }
  ]
}
```

#### Market Order attributes and specificities <a href="#market-order-attributes-and-specificities" id="market-order-attributes-and-specificities"></a>

Market Orders have some attributes in common with Investments, for example `id`, `code`, `label`, `quantity`, `unitprice` and `unitvalue`.

They also have specific attributes, such as the order direction and type of the Market Order, the current state of the Market Order and the Stock Market on which the order was placed.

A Market Order can have up to 3 associated dates: the **creation date**, the **execution date** and the **validity date** (which is usually 3 months after the creation date).

During every synchronization, all market orders are collected and matched with the previous market order list using a stable unique identifier. If there is no such identifer on a given website, the matching is done using static attributes: `date`, `label`, `code` and `direction` (most of the other attributes may vary between the market order creation and its execution or expiration). If a Market Order is matched with a previously collected item, its attributes will be updated, otherwise a new item will is created. The Market Order history depth depends on the website: on some websites, several years of Market Order history are displayed whereas on some others, only pending market orders are available and they disappear after execution.

### Loan Amortizations resource <a href="#market-order-resource" id="market-order-resource"></a>

{% hint style="info" %}
This feature is not activated by default. Please contact your Customer Success Manager to activate it.
{% endhint %}

**Loan Amortizations** correspond to the amortization paid by a user for a loan. Most of the amortization tables available in the user's banking space are updated once a month, starting from the current month or year. We therefore update the information once a month, and the amortization will begin at the earliest on the date of the first synchronization.

```
GET /users/me/accounts/{accountId}/amortizations
GET /users/me/connections/{connectionId}/amortizations
GET /users/me/amortizations
```

```
  "loanamortizations": [
    ...
    {
      "id_account": 1,
      "payment_date": "2024-02-29",
      "amortization_amount": {
        "currency": "EUR",
        "value": 108.0
      },
      "interest_amount": {
        "currency": "EUR",
        "value": 15.0
      },
      "insurance_amount": {
        "currency": "EUR",
        "value": 2.0
      },
      "total_payment_amount": {
        "currency": "EUR",
        "value": 125.0
      },
      "remaining_capital": {
        "currency": "EUR",
        "value": 1500.0
      },
      "last_update": "2024-02-29 14:32:05",
      "deleted": null,
      "period": "2024-02",
      "calculated": [
        "total_payment_amount"
      ]
    },
  ...
  ],
  "total": 42
}
```

{% hint style="info" %} <mark style="color:blue;">The</mark> <mark style="color:blue;"></mark><mark style="color:blue;">`calculated`</mark> <mark style="color:blue;"></mark><mark style="color:blue;">key indicates the list of attributes that are calculated and not directly obtained from the bank (for example,</mark> <mark style="color:blue;"></mark><mark style="color:blue;">`total_payment_amount`</mark> <mark style="color:blue;"></mark><mark style="color:blue;">is the sum of scraped amortization, interest and insurance amounts for a given amortization).</mark>
{% endhint %}


