# Indicators

{% hint style="info" %}
Authentication: endpoint in this page requires [header authentication](https://docs.powens.com/api-reference/overview/authentication) with a user token.
{% endhint %}

## Get indicators data for the user

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/users/{userId}/indicators`

Get indicators metrics computed on end user’s banking data by user ID.

#### Path Parameters

| Name                                     | Type    | Description    |
| ---------------------------------------- | ------- | -------------- |
| userId<mark style="color:red;">\*</mark> | Integer | ID of the user |

{% tabs %}
{% tab title="200: OK User’s indicators metrics" %}
Response body:  [*UserIndicators* object](#userindicators-object)
{% endtab %}
{% endtabs %}

### Data model

### *UserIndicators* object

<table><thead><tr><th width="170"> Property</th><th width="218.33333333333331">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>id_user</code></td><td>Integer</td><td>Id of the user.</td></tr><tr><td><code>indicators</code></td><td>Indicators object</td><td>User's indicators metrics.</td></tr></tbody></table>

### *Indicators object*

<table><thead><tr><th width="249"> Property</th><th width="200">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>avg_current_month</code></td><td><a href="#monthlyindicators-object">MonthlyIndicators</a> object</td><td>Current month average indicators.</td></tr><tr><td><code>total_current_month</code></td><td><a href="#monthlyindicators-object">MonthlyIndicators</a> object</td><td>Current month sum of indicators.</td></tr><tr><td><code>avg_last_30days</code></td><td><a href="#monthlyindicators-object">MonthlyIndicators</a> object</td><td>Last 30 day average indicators.</td></tr><tr><td><code>total_last_30days</code></td><td><a href="#monthlyindicators-object">MonthlyIndicators</a> object</td><td>Last 30 day sum of indicators.</td></tr><tr><td><code>avg_last_60days</code></td><td><a href="#monthlyindicators-object">MonthlyIndicators</a> object</td><td>Last 60 day average indicators.</td></tr><tr><td><code>total_last_60days</code></td><td><a href="#monthlyindicators-object">MonthlyIndicators</a> object</td><td>Last 60 day sum of indicators.</td></tr><tr><td><code>avg_last_90days</code></td><td><a href="#monthlyindicators-object">MonthlyIndicators</a> object</td><td>Last 90 day average indicators.</td></tr><tr><td><code>total_last_90days</code></td><td><a href="#monthlyindicators-object">MonthlyIndicators</a> object</td><td>Last 90 day sum of indicators.</td></tr></tbody></table>

### *MonthlyIndicators* object

<table><thead><tr><th width="223">Property</th><th width="167">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>incoming</code></td><td>Integer</td><td>Sum/average of positive transactions.</td></tr><tr><td><code>outgoing</code></td><td>Integer</td><td>Sum/average of negative transactions.</td></tr><tr><td><code>net_cash_flow</code></td><td>Integer</td><td>Sum/average of transactions.</td></tr><tr><td><code>leverage_ratio</code></td><td>String or null</td><td>Proportion of total of loans amount compared to total of recurrent income.</td></tr><tr><td><code>recurrent_income</code></td><td><a href="#monetaryamount-object"><em>MonetaryAmount</em> </a>object</td><td>Recurring income indicators.</td></tr><tr><td><code>recurrent_outcome</code></td><td><a href="#monetaryamount-object">MonetaryAmount</a> object</td><td>Recurring outcome indicators.</td></tr><tr><td><code>gambling</code></td><td><a href="#gamblingindicators-object">GamblingIndicators </a>object</td><td>Gambling indicators.</td></tr><tr><td><code>loans</code></td><td><a href="#loansindicators-object">LoansIndicators </a>object</td><td>Loans indicators.</td></tr><tr><td><code>return_debit</code></td><td><a href="#returndebitindicators-object">ReturnDebitIndicators</a> object</td><td>Return debit indicators.</td></tr></tbody></table>

### *MonetaryAmount* object

<table><thead><tr><th>Property</th><th width="162">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>num_statements</code></td><td>Decimal or Integer</td><td>Number of  transactions of recurring income categories in the analyzed period. Integer if it is in <code>total_current_month</code>, <code>total_last_30days</code>, <code>total_last_60days</code> or <code>total_last_90days</code>, otherwise it is a Decimal after calculating the average.</td></tr><tr><td><code>total_amount</code></td><td>Integer</td><td>Sum of  transactions of recurring income categories in the analyzed period.</td></tr><tr><td><code>details</code></td><td>String or null</td><td></td></tr></tbody></table>

### *GamblingIndicators* object

<table><thead><tr><th width="276">Property</th><th width="129">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>gambling_ratio</code></td><td>String or null</td><td>Proportion of total of gambling negative amounts compared to total of recurrent income.</td></tr><tr><td><code>income_num_statements</code></td><td>Decimal or Integer</td><td>Number of positive transactions of category Gambling in the analyzed period. Integer if it is in <code>total_current_month</code>, <code>total_last_30days</code>, <code>total_last_60days</code> or <code>total_last_90days</code>, otherwise it is a Decimal after calculating the average.</td></tr><tr><td><code>income_total_amount</code></td><td>Integer</td><td>Sum of positive transactions of category Gambling in the analyzed period.</td></tr><tr><td><code>outcome_num_statements</code></td><td>Decimal or Integer</td><td><p>Number of  negative transactions of category Gambling in the analyzed period.</p><p>Integer if it is in <code>total_current_month</code>, <code>total_last_30days</code>, <code>total_last_60days</code> or <code>total_last_90days</code>, otherwise it is a Decimal after calculating the average.</p></td></tr><tr><td><code>outcome_total_amount</code></td><td>Integer</td><td>Sum of  negative transactions of category Gambling in the analyzed period.</td></tr></tbody></table>

### *LoansIndicators* object

<table><thead><tr><th width="280">Property</th><th width="129">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>income_num_statements</code></td><td>Decimal</td><td>Number of positive transactions of category Loans in the analyzed period.</td></tr><tr><td><code>income_total_amount</code></td><td>Integer</td><td>Sum of positive transactions of category Loans in the analyzed period.</td></tr><tr><td><code>outcome_num_statements</code></td><td>Decimal</td><td>Number of negative transactions of category Loans in the analyzed period.</td></tr><tr><td><code>outcome_total_amount</code></td><td>Integer</td><td>Sum of negative transactions of category Loans in the analyzed period.</td></tr><tr><td><code>details</code></td><td>Array of <a href="#detailsindicators-object">DetailsIndicators </a>objects or null</td><td>List of DetailsIndicators.</td></tr></tbody></table>

### *DetailsIndicators object*&#x20;

| Property      | Type    | Description            |
| ------------- | ------- | ---------------------- |
| `category_id` | Integer | Id of category.        |
| `amount`      | Integer | Amount of transaction. |
| `date`        | String  | Date in string.        |

### *ReturnDebitIndicators* object

<table><thead><tr><th width="211">Property</th><th width="160">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>num_statements</code></td><td>Decimal</td><td>Number of transactions of category Return Debit in the analyzed period. </td></tr><tr><td><code>total_amount</code></td><td>Integer</td><td>Sum of transactions of category Return Debit in the analyzed period. </td></tr></tbody></table>


