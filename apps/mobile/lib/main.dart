import 'package:flutter/material.dart';

import 'api/api_client.dart';
import 'api/token_store.dart';
import 'app.dart';
import 'config.dart';
import 'state/app_state.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final state = AppState(ApiClient(baseUrl: apiBaseUrl, tokens: SecureTokenStore()));
  runApp(LiveCocoApp(state: state));
  // Start-up work runs after the first frame so the price board appears immediately.
  await state.start();
}
