# Powens Connect iOS

The Powens Connect SDK allows you to quickly and easily implement aggregation journeys and connect with Powens APIs in your iOS app.

### Installation

#### From Cocoapods

1. If you haven’t already, install the latest version of [Cocoapods](https://guides.cocoapods.org/using/getting-started.html#installation).
2. If you don’t have an existing [Podfile](https://guides.cocoapods.org/syntax/podfile.html), run the following command to create one at the root of your Xcode project:

```typescript
pod init
```

3. Add this line to your Podfile:

```typescript
pod 'PowensConnect', '1.0.0-beta'
```

4. Run the following command:

```typescript
pod install
```

5. From now on you will use the `.xcworkspace` file to open your Xcode project instead of the `.xcodeproj` file.
6. To update to the latest version of the SDK in the future, run:

```typescript
pod update PowensConnect
```

#### Manually

1. Download and unzip this Github project.
2. Drag **PowensConnect.xcframework** to the **Frameworks, Libraries and Embedded Content** section of the General settings in your Xcode project. Make sure to select **Copy items if needed**.
3. Repeat the above steps in the future to update to the latest version of the SDK.

### Configuration

1. Right-click your `Info.plist` file and choose **Open as > Source Code**.
2. Paste the following into the body of your file (within `<dict>…</dict>`) to configure your Powens domain.

```xml
<key>PowensDomain</key>
<string>YOUR_DOMAIN</string>
```

Replace *YOUR\_DOMAIN* with your actual Powens domain, without the `.biapi.pro` extension.

3. Paste the following into the body of your file (within `<dict>…</dict>`) to configure the Powens Connect dedicated URL scheme.\
   If you already have custom URL schemes, simply paste the additional `CFBundleURLSchemes` to your `CFBundleURLTypes` array.

```xml
<key>CFBundleURLTypes</key>
<array>
	<dict>
		<key>CFBundleURLSchemes</key>
		<array>
			<string>powens-CLIENT_ID</string>
		</array>
	</dict>
</array>
```

Replace *CLIENT\_ID* with your client application ID. You can find your client applications IDs in the [administration console](https://console.powens.com/), under **Applications** within your domain.

### Usage

1. Register for Powens Webview callback notifications from the view controller you wish to present the Powens Webview from.

```objectivec
// Registering for Webview callback notifications
// Allows the automatic dismissal of the presented Webview controller from the source controller
Powens.shared.handler.registerWebviewCallback(sourceViewController: self)
```

2. Open the desired Webview flow among Connect, Manage & Reconnect.\
   Visit our [documentation](https://docs.powens.com/api-reference/overview/webview) for more information about the Webview flows and their usage.

```swift
Task {
    do {
        // Building the Connect flow URL and generating a temporary auth code when provided with an access token
        let handle = try await Powens.shared.launcher.connectFlow(accessToken: token, state: nil, options: options)
        // Building the Manage flow URL and generating a temporary auth code
        let handle = try await Powens.shared.launcher.manageFlow(accessToken: token, connectionId: nil, state: nil, options: options)
        // Building the Reconnect flow URL and generating a temporary auth code
        let handle = try await Powens.shared.launcher.reconnectFlow(accessToken: token, connectionId: connectionId, resetCredentials: resetCredentials, state: nil)
                
        // Presenting the Webview controller from the current view controller
        handle.presentOn(sourceViewController: self)                
    } catch {
        NSLog(error.localizedDescription)
    }
}
```

3. Handle the data received from the app callback URL.

```swift
do {
    try Powens.shared.handler.handleConnectCallback(url: url) { result in
        switch onEnum(of: result) {
            case .webviewConnectCallbackSuccess(let result): self.onConnectSuccess(result: result)
            case .webviewCallbackError(let error): self.onError(error: error)
        }
    }
    try Powens.shared.handler.handleManageCallback(url: url) { result in
        switch onEnum(of: result) {
            case .webviewManageCallbackSuccess(let result): self.onManageSuccess(result: result)
            case .webviewCallbackError(let error): self.onError(error: error)
        }
    }
    try Powens.shared.handler.handleReconnectCallback(url: url) { result in
        switch onEnum(of: result) {
            case .webviewCallbackError(let error): self.onError(error: error)
            default: break
        }
    }
} catch {
    NSLog(error.localizedDescription)
}
```

Please refer to the [example Xcode project](https://github.com/powenscompany/powens-connect-ios/tree/main/Example/connect-ios-demo) from this repository for a complete example of the PowensConnect SDK usage.

### &#x20;License

The Powens Connect SDK is available under the LGPLv3 license. See the [LICENSE](https://github.com/powenscompany/powens-connect-ios/blob/main/LICENSE.md) file for more information.


