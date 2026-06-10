# Introduction to Bank

Leverage Open Banking data through a seamless integration of banking functionalities into your application, empowering your users to view their account balances, transaction history and more. Whether you are building a personal finance app, cash flow modeling or a risk analysis platform, the Bank product offers reliable methods for accessing **checking and card accounts data.**

<figure><img src="/files/XrnivocHXzUFqx1Gvxow" alt=""><figcaption></figcaption></figure>

## How it works

After having the Powens API integrated, your end user will be able to connect its banks accounts.

When this is done, you are allowed to access all transactions from accounts for which the end user has given their consent.

Use Powens Console (from where you manage your apps and find your API credentials) to create a URL that is provided to the end user. When your user selects their URL, they go through a flow where they authenticate with their bank and connect to their bank accounts.

#### End user flow

<figure><img src="/files/sglpvBJRcGtqwvUgZt0Y" alt=""><figcaption></figcaption></figure>

Try it now with our demo tool [here](https://integrate.biapi.pro/2.0/auth/webview/connect?client_id=28105838\&redirect_uri=https://docs.powens.com/demo-integration\&max_connections=4).&#x20;

## Data-type availability

With Bank, you get access to the following list of data:

* Account types: checking accounts and card accounts
* Account information data: Account number, label of the account, IBAN, balance, currency and usage (personal or business account)
* Transaction information data: Amount, dates (book vs. value), original description, cleaned up description, type, counterparty

**Note:** Transaction history depth varies from bank to bank. The minimum transaction history you can fetch is of 3 months.

## Endpoints

* **/accounts**
  * Access the list of accounts and account data associated with the authenticated user.
* **/transactions**
  * Access the list of transactions and transaction data associated with the authenticated user.

## Want more?

* For data from savings, loans and investment accounts, use Powens’ Wealth product.
* For account ownership data, use Powens’ Account Check product.
* For transaction categorisation, use Powens’ Categorizer product.
* For statements, invoices and credit notes, use Powens’ Bank Advanced product.


