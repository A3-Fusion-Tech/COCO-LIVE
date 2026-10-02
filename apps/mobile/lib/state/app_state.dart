import 'package:flutter/widgets.dart';

import '../api/api_client.dart';
import '../api/problem.dart';
import '../l10n/strings.dart';
import '../models/catalog.dart';
import '../models/marketplace.dart';

/// App-wide state: language, catalog and the signed-in user. Screens load their own data
/// through [api] and rebuild when this notifies.
class AppState extends ChangeNotifier {
  AppState(this.api, {String lang = 'ta'}) : _lang = lang {
    api.language = lang;
    api.onSessionExpired = _sessionExpired;
  }

  final ApiClient api;

  String _lang;
  Catalog catalog = Catalog.empty;
  Me? me;

  /// Set when the server ended the session, so the UI can say so once.
  bool sessionExpired = false;

  String get lang => _lang;
  S get strings => S(_lang);
  bool get signedIn => me != null;

  /// Restores the stored session and loads the catalog. Never throws: the public price board
  /// must work without a network round-trip to `/v1/me` succeeding.
  Future<void> start() async {
    await api.restoreSession();
    try {
      catalog = await api.catalog();
    } on ApiProblem {
      // The price board still renders names sent with each price row.
    }
    if (api.isSignedIn) {
      try {
        me = await api.me();
        _applyLanguage(me!.locale);
      } on ApiProblem {
        me = null;
      }
    }
    notifyListeners();
  }

  Future<void> ensureCatalog() async {
    if (catalog.products.isNotEmpty) return;
    catalog = await api.catalog();
    notifyListeners();
  }

  Future<void> signedInWith(SignedIn result) async {
    sessionExpired = false;
    me = await api.me();
    notifyListeners();
  }

  Future<void> refreshMe() async {
    me = await api.me();
    notifyListeners();
  }

  Future<void> signOut({bool everywhere = false}) async {
    try {
      if (everywhere) {
        await api.signOutEverywhere();
      } else {
        await api.signOut();
      }
    } finally {
      me = null;
      notifyListeners();
    }
  }

  /// Switches the UI language; a signed-in user's preference is saved on the server too.
  Future<void> setLanguage(String lang) async {
    if (!supportedLanguages.contains(lang) || lang == _lang) return;
    _applyLanguage(lang);
    notifyListeners();
    if (signedIn) {
      try {
        await api.updateLocale(lang);
      } on ApiProblem {
        // Preference sync is best effort; the local choice still applies.
      }
    }
  }

  void _applyLanguage(String lang) {
    if (!supportedLanguages.contains(lang)) return;
    _lang = lang;
    api.language = lang;
  }

  void _sessionExpired() {
    me = null;
    sessionExpired = true;
    notifyListeners();
  }
}

/// Makes [AppState] available to the widget tree.
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child}) : super(notifier: state);

  static AppState of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;

  /// Reads without subscribing (for callbacks).
  static AppState read(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}
