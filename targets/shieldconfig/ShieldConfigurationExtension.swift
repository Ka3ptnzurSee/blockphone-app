// ShieldConfigurationExtension.swift
//
// Custom Sperr-Screen (ShieldConfiguration) im Nothing-/Dull-Look.
// Wenn eine App gesperrt ist, zeigt iOS DIESEN Screen statt der App.
//
// Extension-Target: com.apple.ManagedSettingsUI.shield-configuration-service
// Prinzipal-Klasse (Info.plist NSExtensionPrincipalClass):
//   $(PRODUCT_MODULE_NAME).ShieldConfigurationExtension
//
// Vorbild: Dull.app → DullShieldConfig.ShieldConfigurationProvider
// (Klasse heißt hier wie vom Target-Plugin erwartet: ShieldConfigurationExtension)
// Texte: "LESS. PLEASE COME AGAIN." / "ITEMIZED ATTENTION:" (Dull v1.9.3, de)
//
// ShieldConfigurationDataSource ist ein PROTOKOLL → KEIN `override`.

import ManagedSettings
import ManagedSettingsUI
import UIKit

final class ShieldConfigurationExtension: NSObject, ShieldConfigurationDataSource {

    // MARK: - Apps

    func configuration(shielding application: Application) -> ShieldConfiguration {
        ShieldConfiguration(
            backgroundColor: .black,
            icon: UIImage(systemName: "minus.circle.fill"),
            title: ShieldConfiguration.Label(
                text: "LESS. PLEASE COME AGAIN.",
                color: .white
            ),
            subtitle: ShieldConfiguration.Label(
                text: "Diese App ist gesperrt. Nichts verpasst.",
                color: UIColor(white: 0.55, alpha: 1)
            ),
            primaryButtonLabel: ShieldConfiguration.Label(
                text: "OK",
                color: .black
            ),
            primaryButtonBackgroundColor: .white,
            secondaryButtonLabel: ShieldConfiguration.Label(
                text: "ENTSPERREN",
                color: .white
            )
        )
    }

    func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        configuration(shielding: application)
    }

    // MARK: - Web-Domains

    func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        ShieldConfiguration(
            backgroundColor: .black,
            icon: UIImage(systemName: "globe"),
            title: ShieldConfiguration.Label(text: "GESPERRT.", color: .white),
            subtitle: ShieldConfiguration.Label(
                text: webDomain.domain ?? "",
                color: UIColor(white: 0.55, alpha: 1)
            ),
            primaryButtonLabel: ShieldConfiguration.Label(text: "OK", color: .black),
            primaryButtonBackgroundColor: .white
        )
    }

    func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
        configuration(shielding: webDomain)
    }
}
