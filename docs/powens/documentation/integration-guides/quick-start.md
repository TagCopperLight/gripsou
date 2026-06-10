# Quick Start

Here you'll set up your environment to start playing with our API. If you don't know what our API is, you can refer to our [API overview](/documentation/integration-guides/quick-start/api-overview.md).

{% hint style="info" %} <mark style="color:blue;">To smooth out the onboarding, along the way we notify how to be compliant with the PSD2.</mark>
{% endhint %}

### Create your account <a href="#create-your-account" id="create-your-account"></a>

[Sign up in our administration console](https://console.budget-insight.com/auth/register). You can then check your inbox, confirm your account and log in. **Congratulations! Welcome to our Console.**

### Register an organization or join one <a href="#register-an-organization-or-join-one" id="register-an-organization-or-join-one"></a>

Once logged in, you will have to fill a few information about your company to create your organization. Here is the information to be filled in:

* company name,
* company size,
* country,
* activity area.

*Your company name will be used as organization name and also to create your first workspace.*

### Register your domain <a href="#register-your-domain" id="register-your-domain"></a>

Once your organization and first workspace are created, click on the creation button (the large "**+**") and choose a domain name. The domain will be created as a "sandbox" configuration, and automatically suffixed with `-sandbox.biapi.pro`.

{% hint style="info" %} <mark style="color:blue;">Use your project name as your domain name to ease management. Avoid generic names like "test" to facilitate tickets management.</mark>
{% endhint %}

In the following sections, we'll use the term "your API" to refer to calls made to your domain.

### Register a client application <a href="#register-a-client-application" id="register-a-client-application"></a>

A client application identifies a caller requesting your API. You need at least one client.

The definition of a client application lets you configure the associated Webview, a ready-to-use web interface to add connections to your domain. You can configure multiple client applications if you wish to propose webviews with different settings.

From the administration console:

* select your domain and click on "Client Applications" on the left sidebar;
* in the upper-right corner, click on "Add a client" and fill the form;
* modify the logo, layout and primary colors;
* configure a redirect URL that is used by the webview after the connection flow;
* click on "Add a client". Your client should now appear in the list of client applications.

{% hint style="info" %} <mark style="color:blue;">You can define multiple redirect URLs for a single client application. You must use secure HTTPS protocol, or an app-specific scheme.</mark>
{% endhint %}

{% hint style="warning" %} <mark style="color:orange;">The created "Client ID" and "Client secret", represent your base credentials when querying the API or requesting the webview.</mark>
{% endhint %}

### Register a webhook <a href="#register-a-webhook" id="register-a-webhook"></a>

In addition to a REST API, we provide you with a [webhook mechanism](/documentation/integration-guides/webhooks.md) that is the recommanded approach to be notified when new data is available in your API. You can declare a subscription to a webhook in the console and we will push the data to your server when the appropriate event occurs.

To add a webhook:

* click on "Webhooks" on the left sidebar;
* click on the button "Add a webhook" on the upper-righ corner;
* select an event and type your server URL.

### Integrate the API <a href="#integrate-the-api" id="integrate-the-api"></a>

Well done! Now that your domain is properly configured, you can use the API starting by [adding users and connections](/documentation/integration-guides/quick-start/add-a-first-user-and-connection.md) or [initiating payments](broken://pages/Xc77IG4DjS9kUvaAdxOW).

{% hint style="info" %} <mark style="color:blue;">For a trial or a quick demo you have the opportunity to easily test a connection with a fake connector "Connecteur de test", available in all domains. Use any username and the password "1234" to log in.</mark>
{% endhint %}


