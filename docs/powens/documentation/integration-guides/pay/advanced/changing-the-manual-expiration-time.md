# Changing the manual expiration time

Every Pay domain defines a number of days after which, if a payment is still `pending`, its state will be changed to `expired`. This information is stored in the configuration, and is set to 30 days by default.

In order to change it to e.g. 7 days, you can do the following call using a config or administration token:

```
POST /config
```

```json
{
  "payment.manual_expire_time_days": "7"
}
```


