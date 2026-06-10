# Connection Identity

{% hint style="warning" %}
This feature is not activated by default on your domain. Please contact us to request access.
{% endhint %}

## API endpoints

## List identity

`GET` `https://{domain}.biapi.pro/2.0/users/{user_id}/connections/{connection_id}/owner_identity`

List the user name and postal address.

## List identity

<mark style="color:green;">`GET`</mark> `/users/{user_id}/connections/{connection_id}/owner_identity`

Get the user name and postal address.

**Path Parameters**

| Name   | Type            | Description               |
| ------ | --------------- | ------------------------- |
| userId | Integer or "me" | ID for the releated user. |

**Response**

{% tabs %}
{% tab title="200" %}
Response body: [#owneridentity-object](#owneridentity-object "mention")
{% endtab %}
{% endtabs %}

**Data model**

## ***OwnerIdentity*****&#x20;object**

| Property             | Type                                                     | Description                     |
| -------------------- | -------------------------------------------------------- | ------------------------------- |
| `id_connection`      | Integer                                                  | ID of the related connection.   |
| `id_source`          | Integer                                                  | ID of the related source.       |
| `id_user`            | Integer                                                  | ID of the related user.         |
| `first_name`         | String or null                                           | First name of the user.         |
| `last_name`          | String or null                                           | Last name of the user.          |
| `full_name`          | String                                                   | Full name of the user           |
| `raw_postal_address` | String or null                                           | Raw postal address of the user. |
| `postal_address`     | [#postaladdress-object](#postaladdress-object "mention") | Postal address of the user.     |

## *PostalAddress* object

| Property       | Type           | Description               |
| -------------- | -------------- | ------------------------- |
| `city`         | String or null | City of the user.         |
| `country`      | String or null | Country of the user.      |
| `country_code` | String or null | Country code of the user. |
| `postal_code`  | String or null | Postal code of the user.  |
| `region`       | String or null | Region of the user.       |
| `street_name`  | String or null | Street of the user.       |


