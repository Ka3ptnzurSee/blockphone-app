// ShieldActionExtension.swift
//
// Button-Aktion auf dem custom Sperr-Screen (ShieldActionExtension).
// Der "primary"/"secondary" Button der ShieldConfiguration kann hierüber
// eine Aktion auslösen (z. B. URL-Scheme in die App öffnen).
//
// Extension-Target: com.apple.ManagedSettings.shield-action-service
// Prinzipal-Klasse (Info.plist NSExtensionPrincipalClass):
//   $(PRODUCT_MODULE_NAME).ShieldActionExtension
//
// ShieldActionDelegate ist ein PROTOKOLL → KEIN `override`.

import ManagedSettings
import ManagedSettingsUI

final class ShieldActionExtension: NSObject, ShieldActionDelegate {

    func handle(action: ShieldAction,
                for application: Application,
                completionHandler: @escaping (ShieldActionResponse) -> Void) {
        switch action {
        case .primaryButtonPressed:
            completionHandler(.close)
        case .secondaryButtonPressed:
            // URL-Scheme in die Haupt-App → dort entsperren/loggen.
            completionHandler(.none)
        @unknown default:
            completionHandler(.none)
        }
    }

    func handle(action: ShieldAction,
                for webDomain: WebDomain,
                completionHandler: @escaping (ShieldActionResponse) -> Void) {
        switch action {
        case .primaryButtonPressed:
            completionHandler(.close)
        default:
            completionHandler(.none)
        }
    }

    func handle(action: ShieldAction,
                for category: ActivityCategory,
                completionHandler: @escaping (ShieldActionResponse) -> Void) {
        completionHandler(.none)
    }
}
