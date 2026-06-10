# End-to-end encryption

Banking credentials are very sensitive data. As an integrator of our services, you must ensure that confidentiality is guaranteed all the way from the user interface where they are entered, to our API endpoint where they are consumed. The whole transmission flow must be processed over a [secure transport protocol](https://en.wikipedia.org/wiki/HTTPS), but it may still involve intermediate components such as third-party API servers or caches that are **not** legally authorized to handle cleartext credentials.

{% hint style="info" %} <mark style="color:blue;">Implementing end-to-end encryption is</mark> <mark style="color:blue;"></mark><mark style="color:blue;">**mandatory**</mark> <mark style="color:blue;"></mark><mark style="color:blue;">for both BI agents and partners when not using our Connect webview. Encryption is strongly advised for white-mark contracts.</mark>
{% endhint %}

Our API allows you to secure user credentials transmission using [asymmetric key cryptography](https://en.wikipedia.org/wiki/Public-key_cryptography), by encrypting values **before they are transmitted** to your intermediate architecture. The resulting payload can only be decrypted by our API.

UserUser InterfaceIntermediate APIOur APIEncrypt credentialsDecrypt credentials🔓 Enter credentials🔒 Encrypted credentials🔒 Encrypted credentials

### Endpoints support <a href="#endpoints-support" id="endpoints-support"></a>

End-to-end encryption apply to the following endpoints:

* [Connection creation](https://docs.powens.com/api-reference/user-connections/connections) for initial values of a connector's fields (this endpoint is only accessible to agents and white-mark contracts);
* [Connection update](https://docs.powens.com/api-reference/user-connections/connections#update-a-connection) for values of transient additionnal fields;
* Transfer update for values of transient additionnal fields;
* [Payment update for static field values](/documentation/integration-guides/pay/advanced/implementing-your-own-payment-validation-webview.md#prepare-the-expected-fields), when implementing a validation webview.

### Encryption steps <a href="#encryption-steps" id="encryption-steps"></a>

End-to-end encryption consists in substituting every cleartext sensitive values in HTTP requests with an encrypted [JSON Web Encryption (JWE) payload](https://tools.ietf.org/html/rfc7516). The resulting HTTP request body is still a JSON object, with modified values.

<table data-header-hidden><thead><tr><th width="363"></th><th></th></tr></thead><tbody><tr><td><pre class="language-http"><code class="lang-http">POST /user/me/connections
</code></pre><pre class="language-js"><code class="lang-js">{
  "id_connector": 33,
  "username": "john",
  "password": "cleartext"
}
</code></pre></td><td><pre class="language-http"><code class="lang-http">POST /user/me/connections
</code></pre><pre class="language-js"><code class="lang-js">{
  "id_connector": 33,
  "username": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
  "password": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
}
</code></pre></td></tr><tr><td><mark style="color:red;">Before: Cleartext credentials as string value in request body</mark></td><td><mark style="color:green;">After: Sensitive values are encrypted in request body</mark></td></tr></tbody></table>

{% hint style="info" %}
We strongly advise relying on existing cryptography libraries to achieve proper JWE encryption. The choice of a library will likely vary with your specific environment and configuration. We suggest the following projects:

* [js-jose](https://github.com/square/js-jose), a JavaScript library with good browser compatibility, available as an [npm package](https://www.npmjs.com/package/jose-jwe-jws);
* [Nimbus JOSE](https://connect2id.com/products/nimbus-jose-jwt), a Java library usable in Android native apps;
* [JOSESwift](https://github.com/airsidemobile/JOSESwift), a framework written in Swift, usable in iOS native apps;
* [jwcrypto](https://jwcrypto.readthedocs.io/), a Python2/3 implementation.
  {% endhint %}

Implementation details vary with each library. They usually include the following steps:

1. Obtain the public end-to-end encryption key associated with your API domain by calling the following endpoint. The key is available as a [JSON Web Key (JWK)](https://tools.ietf.org/html/rfc7517).
2. ```http
   GET /publickey
   ```
3. Import the key according to the library documentation.
4. If needed, convert text values of credentials to raw bytes (UTF-8 encoding).
5. Encrypt the payload according to the library documentation, with **RSA-OAEP-256** padding and **A256GCM** algorithm. We require the key ID (`kid`) to be included in the JWE header.
6. Serialize the JWE to its compact format (URL-safe Base64 parts delimited by period), ready to be sent to our API.

{% hint style="info" %}
Encryption keys are available in the [administration console](https://console.budget-insight.com/), on your domain's settings page.
{% endhint %}

### Examples <a href="#examples" id="examples"></a>

<details>

<summary>TypeScript integration using <a href="https://github.com/square/js-jose">js-jose</a> library</summary>

```js

  import { Jose } from 'jose-jwe-jws';

  async encrypt(values: { [key: string]: any }): Promise<{ [key: string]: any }> {
    // Import your public key
    const jwkRsa = JSON.parse('<Your public key here>') as JWKRSA;
    const key = await Jose.Utils.importRsaPublicKey(jwkRsa, 'RSA-OAEP');
    // Prepare an encrypter
    const cryptographer = new Jose.WebCryptographer();
    const encrypter = new Jose.JoseJWE.Encrypter(cryptographer, key);
    encrypter.addHeader('kid', jwkRsa.kid);
    // Encrypt cleartext values independently
    const encrypted: { [key: string]: string } = {};
    for (const k of Object.keys(values)) {
      encrypted[k] = await encrypter.encrypt(values[k]);
    }
    return encrypted;
  }
```

</details>

<details>

<summary>Kotlin integration using <a href="https://connect2id.com/products/nimbus-jose-jwt">Nimbus JOSE</a> library</summary>

```kotlin
 import com.nimbusds.jose.*
  import com.nimbusds.jose.crypto.RSAEncrypter
  import com.nimbusds.jose.jwk.RSAKey

  fun encrypt(values: Map<String, Any>) : Map<String, String> {
    // Import your public key
    val key = RSAKey.parse('<Your public key here>')
    // Prepare an encrypter
    val header = JWEHeader.Builder(JWEAlgorithm.RSA_OAEP_256, EncryptionMethod.A256GCM)
      .keyID(key.keyID)
      .build()
    val encrypter = RSAEncrypter(key)
    // Encrypt cleartext values independently
    return values.mapValues {
      JWEObject(header, Payload(it.value.toString().toByteArray()))
        .also { it.encrypt(encrypter) }
        .serialize()
    }
  }
```

</details>

<details>

<summary>Swift integration using <a href="https://github.com/airsidemobile/JOSESwift">JOSESwift</a> library</summary>

```swift

  import JOSESwift

  func encrypt(values: [String: String]) throws -> [String: String] {
    // Import your public key
    let keyJson = try JSONSerialization.jsonObject(
      with: "<Your public key here>".data(using: .utf8)!,
      options: .allowFragments
    ) as? [String: String]
    guard let keyData = try? JSONSerialization.data(withJSONObject: keyJson) else { throw EncryptionError }
    let jwk = try? RSAPublicKey(data: keyData)
    let key = try? jwk?.converted(to: SecKey.self)
    // Prepare an encrypter
    var header = JWEHeader(algorithm: .RSAOAEP256, encryptionAlgorithm: .A256CBCHS512)
    header.kid = keyJson!["kid"]
    guard let encrypter = Encrypter(
      keyEncryptionAlgorithm: .RSAOAEP256,
      encryptionKey: key,
      contentEncyptionAlgorithm: .A256CBCHS512
    ) else { throw EncryptionError }
    // Encrypt cleartext values independently
    var encrypted: [String: String] = [:]
    for key in values.keys {
        guard let data = values[key]?.data(using: .utf8) else { throw EncryptionError }
        let payload = Payload(data)
        guard let jwe = try? JWE(header: header, payload: payload, encrypter: encrypter) else { throw EncryptionError }
        encrypted[key] = jwe.compactSerializedString
    }
    return encrypted
  }
```

</details>


