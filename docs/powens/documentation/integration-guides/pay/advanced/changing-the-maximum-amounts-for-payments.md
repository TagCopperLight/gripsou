# Changing the maximum amounts for payments

You can set the maximum amount for payments you create on the APIs, e.g. for security reasons. This information is stored in the configuration, and adopts the limitation of the environment by default, i.e. 10€ for sandboxes, and unlimited in production.

In order to change it to e.g. 20€ in production, you can do the following call using a config or administration token:

```
POST /config
```

```json
{
  "payment.max_amount": "20"
}
```

{% hint style="warning" %}
If you set a limit of 20€ on a sandbox domain through this configuration variable, the limitation to 10€ applied to all sandbox domains will still apply first, so it will be impossible to create 15€ payments for example.
{% endhint %}


