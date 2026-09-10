#!/bin/bash
# Self-contained ScreenVeil launcher. It compiles the embedded Swift source in
# a temporary directory, so no app folder, binary, or password file lives in $HOME.
set -euo pipefail
scratch_dir="${TMPDIR:-/private/tmp}/screenveil-${UID}"
source_file="$scratch_dir/ScreenVeil.swift"
binary_file="$scratch_dir/ScreenVeil"
mkdir -p "$scratch_dir"
awk '/^: <<'"'"'__SCREENVEIL_SWIFT__'"'"'$/{ found = 1; next } found && /^__SCREENVEIL_SWIFT__$/{ exit } found { print }' "$0" > "$source_file"
if [[ ! -x "$binary_file" || "$source_file" -nt "$binary_file" ]]; then
  /usr/bin/swiftc "$source_file" -o "$binary_file" -framework AppKit -framework Security -framework IOKit
fi
[[ "${1:-}" == "--check" ]] && exit 0
exec "$binary_file" "$@"
: <<'__SCREENVEIL_SWIFT__'
import AppKit
import IOKit
import IOKit.graphics
import Security

private let service = "io.github.chatgpt-web-cli.screenveil"
private let account = "unlock-password"

private func requestedBrightness() -> Float {
    guard let index = CommandLine.arguments.firstIndex(of: "--brightness") else { return 0.20 }
    guard index + 1 < CommandLine.arguments.count,
          let value = Float(CommandLine.arguments[index + 1]),
          (0...1).contains(value) else {
        fputs("ScreenVeil: --brightness must be between 0.0 and 1.0.\n", stderr)
        exit(2)
    }
    return value
}

private let targetBrightness = requestedBrightness()

final class LockWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class ScreenVeil: NSObject, NSApplicationDelegate {
    private var windows: [LockWindow] = []
    private var passwordField = NSSecureTextField()
    private var confirmField: NSSecureTextField?
    private var errorLabel = NSTextField(labelWithString: "")
    private var isSettingPassword = false
    private var allowTermination = false
    private weak var primaryWindow: LockWindow?
    private var originalBrightness: [(service: io_service_t, value: Float)] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        isSettingPassword = storedPassword() == nil
        buildOverlayWindows()
        NSApp.activate(ignoringOtherApps: true)
        focusPasswordField()
        dimDisplays(to: targetBrightness)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        allowTermination ? .terminateNow : .terminateCancel
    }

    func applicationWillTerminate(_ notification: Notification) {
        restoreDisplayBrightness()
    }

    private func buildOverlayWindows() {
        let screens = NSScreen.screens
        guard let primary = NSScreen.main ?? screens.first else { return }
        for screen in screens {
            let window = LockWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false, screen: screen)
            // Keep the veil visually black without advertising a fully opaque
            // occluding window to background applications such as Chrome.
            window.isOpaque = false
            window.alphaValue = 0.999
            window.backgroundColor = NSColor(hex: 0x0B0D0C)
            window.hasShadow = false
            window.level = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()) + 1)
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            if screen == primary {
                window.contentView = makeUnlockView()
                primaryWindow = window
            }
            window.makeKeyAndOrderFront(nil)
            windows.append(window)
        }
    }

    private func makeUnlockView() -> NSView {
        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor(hex: 0x0B0D0C).cgColor
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false

        let signal = NSTextField(labelWithString: "●  SCREEN VEIL")
        signal.font = .monospacedSystemFont(ofSize: 11, weight: .bold)
        signal.textColor = NSColor(hex: 0x33D17A)
        stack.addArrangedSubview(signal)
        let title = NSTextField(labelWithString: isSettingPassword ? "Set a password" : "Screen veiled")
        title.font = .systemFont(ofSize: 31, weight: .semibold)
        title.textColor = NSColor(hex: 0xE8E8E8)
        stack.addArrangedSubview(title)
        let detail = NSTextField(labelWithString: isSettingPassword ? "Stored only in your macOS Keychain." : "Enter your password to continue using this Mac.")
        detail.font = .systemFont(ofSize: 13)
        detail.textColor = NSColor(hex: 0xA7AAA8)
        detail.alignment = .center
        detail.maximumNumberOfLines = 2
        stack.addArrangedSubview(detail)

        let passwordInput = makePasswordInput(isSettingPassword ? "New password" : "Password")
        passwordField = passwordInput.field
        stack.addArrangedSubview(passwordInput.container)
        passwordInput.container.widthAnchor.constraint(equalToConstant: 290).isActive = true
        if isSettingPassword {
            let confirmInput = makePasswordInput("Confirm password")
            confirmField = confirmInput.field
            stack.addArrangedSubview(confirmInput.container)
            confirmInput.container.widthAnchor.constraint(equalTo: passwordInput.container.widthAnchor).isActive = true
        }
        errorLabel.textColor = NSColor(hex: 0xFF625A)
        errorLabel.font = .systemFont(ofSize: 13)
        errorLabel.alignment = .center
        errorLabel.maximumNumberOfLines = 2
        stack.addArrangedSubview(errorLabel)
        let buttonTitle = isSettingPassword ? "Set & Veil" : "Unlock"
        let button = NSButton(title: buttonTitle, target: self, action: #selector(submit(_:)))
        button.isBordered = false
        button.wantsLayer = true
        button.layer?.backgroundColor = NSColor(hex: 0xE8E8E8).cgColor
        button.layer?.cornerRadius = 21
        button.attributedTitle = NSAttributedString(
            string: buttonTitle,
            attributes: [.font: NSFont.systemFont(ofSize: 13, weight: .bold), .foregroundColor: NSColor(hex: 0x111111)]
        )
        button.keyEquivalent = "\r"
        stack.addArrangedSubview(button)
        button.widthAnchor.constraint(equalTo: passwordInput.container.widthAnchor).isActive = true
        button.heightAnchor.constraint(equalToConstant: 42).isActive = true
        root.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: root.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: root.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: root.trailingAnchor, constant: -24)
        ])
        return root
    }

    private func makePasswordInput(_ placeholder: String) -> (container: NSView, field: NSSecureTextField) {
        let container = NSView()
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor(hex: 0x141715).cgColor
        container.layer?.borderColor = NSColor(hex: 0xE8E8E8).cgColor
        container.layer?.borderWidth = 1
        container.layer?.cornerRadius = 17
        container.translatesAutoresizingMaskIntoConstraints = false

        let field = NSSecureTextField()
        field.placeholderString = placeholder
        field.font = .systemFont(ofSize: 16, weight: .medium)
        field.alignment = .center
        field.cell?.alignment = .center
        field.textColor = NSColor(hex: 0xE8E8E8)
        field.drawsBackground = false
        field.isBezeled = false
        field.focusRingType = .none
        field.translatesAutoresizingMaskIntoConstraints = false
        field.target = self
        field.action = #selector(submit(_:))
        container.addSubview(field)
        NSLayoutConstraint.activate([
            container.heightAnchor.constraint(equalToConstant: 34),
            field.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
            field.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -12),
            field.centerYAnchor.constraint(equalTo: container.centerYAnchor)
        ])
        return (container, field)
    }

    @objc private func submit(_ sender: Any?) {
        let password = passwordField.stringValue
        guard !password.isEmpty else { showError("Enter a password."); return }
        if isSettingPassword {
            guard password == confirmField?.stringValue else {
                showError("Passwords do not match.")
                confirmField?.stringValue = ""
                focusPasswordField()
                return
            }
            guard savePassword(password) else {
                showError("Could not save to Keychain. Please try again.")
                return
            }
            isSettingPassword = false
            primaryWindow?.contentView = makeUnlockView()
            focusPasswordField()
            return
        }
        guard password == storedPassword() else {
            showError("Incorrect password.")
            passwordField.stringValue = ""
            focusPasswordField()
            return
        }
        allowTermination = true
        NSApp.terminate(nil)
    }

    private func focusPasswordField() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.primaryWindow?.makeKey()
            self.primaryWindow?.makeFirstResponder(self.passwordField)
            self.passwordField.currentEditor()?.alignment = .center
        }
    }
    private func showError(_ message: String) { errorLabel.stringValue = message }
    private func dimDisplays(to brightness: Float) {
        var iterator: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IODisplayConnect"), &iterator) == KERN_SUCCESS else { return }
        defer { IOObjectRelease(iterator) }
        while true {
            let display = IOIteratorNext(iterator)
            if display == 0 { break }
            var current: Float = 0
            if IODisplayGetFloatParameter(display, 0, kIODisplayBrightnessKey as CFString, &current) == kIOReturnSuccess {
                originalBrightness.append((display, current))
                _ = IODisplaySetFloatParameter(display, 0, kIODisplayBrightnessKey as CFString, brightness)
            } else {
                IOObjectRelease(display)
            }
        }
    }

    private func restoreDisplayBrightness() {
        for original in originalBrightness {
            _ = IODisplaySetFloatParameter(original.service, 0, kIODisplayBrightnessKey as CFString, original.value)
            IOObjectRelease(original.service)
        }
        originalBrightness.removeAll()
    }

    private func storedPassword() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    private func savePassword(_ password: String) -> Bool {
        let data = Data(password.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return true }
        guard update == errSecItemNotFound else { return false }
        var add = query
        add[kSecValueData as String] = data
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }
}

private extension NSColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xff) / 255,
                  green: CGFloat((hex >> 8) & 0xff) / 255,
                  blue: CGFloat(hex & 0xff) / 255, alpha: 1)
    }
}
let app = NSApplication.shared
let delegate = ScreenVeil()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
__SCREENVEIL_SWIFT__
