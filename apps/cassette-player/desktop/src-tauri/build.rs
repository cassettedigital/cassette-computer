fn main() {
    // Declare the app's own IPC commands so tauri-build autogenerates their ACL
    // permissions (`allow-<command>`). Without this there is no app-command
    // manifest, and the commands cannot be granted to the webview when it runs
    // from a remote origin (our UI is served from a loopback Node server, not the
    // tauri:// asset protocol), so the device-token pairing invokes are denied
    // with "not allowed. Plugin not found". The capability then references these.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            // No command hands the token to the page (BUG-784): the shell reads it
            // itself, and the UI server gets it at spawn.
            tauri_build::AppManifest::new().commands(&[
                "clear_device_token",
                "begin_pairing",
                "check_for_update",
                "install_update",
                "add_music",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
