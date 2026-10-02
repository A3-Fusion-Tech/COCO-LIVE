/// Build-time configuration.
///
/// `flutter run --dart-define=API_BASE_URL=https://api.example.in` points the app at an API.
/// The default reaches a local API on port 4000 from the Android emulator (10.0.2.2 is the
/// host machine's loopback as seen from the emulator).
const String apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:4000');
