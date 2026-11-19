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
// WICHTIG: `ShieldConfigurationDataSource` ist in aktuellen SDKs eine KLASSE
// (NSObject-Subklasse) und KEIN Protokoll. Deshalb wird sie beerbt (nicht
// zusammen mit NSObject aufgelistet — das war der Build-Fehler
// "multiple inheritance from classes 'NSObject' and 'ShieldConfigurationDataSource'")
// und alle Methoden sind `override`.

import ManagedSettings
import ManagedSettingsUI
import UIKit

final class ShieldConfigurationExtension: ShieldConfigurationDataSource {

    // MARK: - Apps

    override func configuration(shielding application: Application) -> ShieldConfiguration {
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

    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        configuration(shielding: application)
    }

    // MARK: - Web-Domains

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        ShieldConfiguration(
            backgroundColor: .black,
            icon: UIImage(systemName: "globe"),
            title: ShieldConfiguration.Label(text: "GESPERRT.", color: .white),
            subtitle: ShieldConfiguration.Label(
                text: webDomain.domain ?? "",
                color: UIColor(white: 0.55, alpha: 1)
            ),
            primaryButtonLabel: ShieldConfiguration.Label(text: "OK", color: .black),
            primaryButtonBackgroundColor: .white,
            secondaryButtonLabel: ShieldConfiguration.Label(
                text: "ENTSPERREN",
                color: .white
            )
        )
    }

    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
        configuration(shielding: webDomain)
    }
}
