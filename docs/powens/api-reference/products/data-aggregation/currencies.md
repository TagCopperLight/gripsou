# Currencies

## API endpoint

## List supported currencies

<mark style="color:blue;">`GET`</mark> `https://{domain}.biapi.pro/2.0/currencies`

This endpoint does **not** require authentication.

{% tabs %}
{% tab title="200: OK List of currencies" %}
Response body: [#currencieslist-object](#currencieslist-object "mention")
{% endtab %}
{% endtabs %}

## Data model

### *CurrenciesList* object

<table><thead><tr><th width="191.33333333333331">Property</th><th width="247">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>currencies</code></td><td>Array of <a href="#currency-object"><em>Currency</em></a> objects</td><td>List of supported currencies.</td></tr></tbody></table>

### *Currency* object

<table><thead><tr><th width="192">Property</th><th width="138.33333333333331">Type</th><th>Description</th></tr></thead><tbody><tr><td><code>id</code></td><td>String</td><td>ID of the currency (<a href="https://en.wikipedia.org/wiki/ISO_4217">ISO 4217 code</a>).</td></tr><tr><td><code>name</code></td><td>String</td><td>Display name of the currency.</td></tr><tr><td><code>symbol</code></td><td>String</td><td>Display symbol of the currency.</td></tr><tr><td><del><code>crypto</code></del></td><td>Boolean</td><td><em>(Deprecated)</em> Flag for cryptocurrencies.</td></tr><tr><td><code>precision</code></td><td>Number</td><td>Number or decimal digits for the currency.</td></tr></tbody></table>


