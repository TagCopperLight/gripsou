# gripsou

## Overview

gripsou is a self-hosted personal finance dashboard. You can connect to it with multiple bank accounts, and it will sync your transactions and holdings. You can then see your net worth and how it's distributed across your accounts.

### Data providers

The app is not made for a specific provider, so you can easily add new providers by just respecting the interfaces provided by the app.
When adding a new connection, we ask the user which provider they want to use. A connection could be a bank account, but it could also be a connection to a bank, with multiple accounts.

The goal is to have a general enough interface/database structure so that adding new providers is easy.

## Pages

- Dashboard
- Accounts
- Transactions
- Settings

### Format

The theme is dark, white text, green and red accent colors (green for positive, red for negative gains/losses). Every value is rounded to 2 decimals, and there's always percentages and gains/losses next to the values in parentheses. The format of all numbers can be changed in the settings (e.g. currency symbol in front or after, commas or dots, etc ...).
Percentages are shown with a % sign at the end and one decimal.

The whole website has a sidebar on the left with the links to the pages, the logo at the top.

There's no separation for the sidebar, the items in the sidebar or even the content. Every item is in a rounded container. The sidebar items are in this container either when they are selected or hovered.

Everywhere you go, there's a sync button. It opens a modal, where you can see the last sync date for each connection (a connection is not a provider, as one provider can have multiple connections). You can then sync this connection. The button will have a loading state when the connection is syncing. There's a sync all button that syncs all connections.

## Dashboard

The goal of the dashboard is to give you an overview of your net worth and how it's distributed across your accounts. You also get an overview of your holdings. But it's not detailed at all.

- Total net worth and total gain/loss (in value and percent) in the chart selected time range
- Total net worth chart (net worth and capital invested)
- Account value distribution
- Holdings

### Charts

There's two charts in the dashboard:

#### Total net worth chart

It shows the evolution of the net worth and capital invested over time. Time ranges are 24h, 7d, 1mo, 6mo, 1y, ytd, max. It's a line chart with the net worth and the invested capital. There's a button to show the gain/loss in percentage or in value.

The scale on the y-axis (lowest value and highest value of the chart) should be discussed, 0 to max + 10% ? Or 10% below lowest value and max + 10%? What is the best way to represent the data?

#### Account value distribution

It's a pie chart showing the distribution of the net worth across the different accounts. Each account has a color. There's a legend showing the percentage of the total net worth that each account represents, and its absolute value.

### Holdings

Holdings are every asset you own, it's composed of all liquid and non-liquid assets (cash, stocks, crypto, etc ...). Each holding belongs to an account, and each account has a type:
- Checking
- Savings
- PEA
- Brokerage
- Life insurance
- Retirement
- Crypto

But account types could be added in the future.

They are shown in a list, searchable, and filterable by account type. In the list there's:
- Asset logo
- Asset name
- Quantity owned
- In what account it is
- Account type
- Current value
- Unrealized gain/loss (in value and percent)
- A small chart of the asset's value evolution over time (last 30 days)

#### Asset modal

Clicking on an asset in the holdings list opens and very large modal (all the page size) that details the asset. The modals shows :

- Asset logo, name, account type

Then there's two modes you can chose. One that details the current asset, and one that details the purchases of this asset.

- Price of the asset and evolution over time (same time range as the chart explained below) and the gain/loss (percentage and value) over time (of either the asset or the purchases).
- Chart of the asset's value evolution over time (24h, 7d, 1mo, 6mo, 1y, ytd, max).
    - In mode 1, Show the unit price.
    - In mode 2, Show the total value of the asset (quantity * unit price), and the capital invested (quantity * purchase price). So, in the chart, the capital invested will be a staircase graph, and the total value will be a line chart (that jumps every time there's a new purchase).
- Quantity owned, capital invested and mean price/share, total unrealized gain/loss (in value and percent), account.

## Accounts

The page starts like the dashboard with the total net worth and total gain/loss (in value and percent) in the selected time range. 
There's the same chart as in the dashboard, but it's a stacked area chart showing the evolution of the value of each account over time. Each account has a color.
Then, there's a list of all accounts with :
- Account name, type
- Total value
- Source (which connection from which provider)
- Last sync date

Accounts types are : (could be added in the future)
- Checking (Cash)
- Savings (Cash)
- PEA (PEA)
- Brokerage (Brokerage)

Each account have a color, it's used in the charts and when showing holdings.

At the top of the account item (in the list), there's an edit button, that opens a modal to edit the account settings (name, type, color).

## Transactions

For now it's a blank page, but the goal is to show all transactions, searchable and filterable by account, date range, etc ...

## Settings

In the settings you can chose :
- The locale (english or french)
- Date format (e.g. DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD)
- Number (currency, percentage) format (e.g. 1,000.00, 1.000,00, etc ...)
- Account name and password.

If you are admin, there's additional options in settings : 
- Manage users, (add, remove, reset password, make admin)
- CORS origins
- Choose between data providers

## Users

There's at least one admin. The admin can add, remove, reset password, make admin new users.
When adding a user, that justs create a link to share. Whoever clicks the link, can create their own account (chose name, email, and password).
Removing a user just delete the user and all their data. There's a modal that asks to write their email to confirm it.
Resetting the password creates a new link to share, that the user must click to reset their password.

A link is valid for 24 hours, it's a long string of random characters.
When creating an account with the link, the new user is told that whoever owns the server, has access to all their data.

## Features to implement in future

- Transactions page
- Allow manual transaction entry, and manual accounts
- Support multiple currencies (not only what's shown, but also allow people to have accounts in different currencies and convert them to a base currency)
- For ETFs, add two lines in the modal, one for countries and one for sectors. Show distribution (e.g. 50% US, 40% EU, 10% Asia).
- 2FA
- Connected devices