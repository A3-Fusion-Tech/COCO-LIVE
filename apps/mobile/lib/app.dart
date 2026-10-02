import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'screens/account_screen.dart';
import 'screens/deals_screen.dart';
import 'screens/market_screen.dart';
import 'screens/prices_screen.dart';
import 'screens/trade_screen.dart';
import 'state/app_state.dart';
import 'widgets/common.dart';

/// Material 3 theme with touch targets of at least 48 dp on every button.
ThemeData buildTheme(Brightness brightness) {
  const minSize = Size(minTouchTarget, minTouchTarget);
  final buttonStyle = ButtonStyle(minimumSize: WidgetStateProperty.all(minSize));
  return ThemeData(
    useMaterial3: true,
    colorSchemeSeed: const Color(0xFF2E7D32),
    brightness: brightness,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    visualDensity: VisualDensity.standard,
    filledButtonTheme: FilledButtonThemeData(style: buttonStyle),
    outlinedButtonTheme: OutlinedButtonThemeData(style: buttonStyle),
    textButtonTheme: TextButtonThemeData(style: buttonStyle),
    elevatedButtonTheme: ElevatedButtonThemeData(style: buttonStyle),
    inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
  );
}

class LiveCocoApp extends StatelessWidget {
  const LiveCocoApp({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: state,
      child: ListenableBuilder(
        listenable: state,
        builder: (context, _) => MaterialApp(
          onGenerateTitle: (_) => state.strings.t('app.title'),
          debugShowCheckedModeBanner: false,
          theme: buildTheme(Brightness.light),
          darkTheme: buildTheme(Brightness.dark),
          locale: Locale(state.lang),
          supportedLocales: const [Locale('ta'), Locale('en')],
          localizationsDelegates: GlobalMaterialLocalizations.delegates,
          home: const HomeShell(),
        ),
      ),
    );
  }
}

class _Tab {
  const _Tab(this.labelKey, this.icon, this.builder, {this.needsSignIn = false});
  final String labelKey;
  final IconData icon;
  final Widget Function() builder;
  final bool needsSignIn;
}

final _tabs = [
  _Tab('nav.prices', Icons.trending_up, () => const PricesScreen()),
  _Tab('nav.market', Icons.storefront_outlined, () => const MarketScreen()),
  _Tab('nav.trade', Icons.inventory_2_outlined, () => const TradeScreen(), needsSignIn: true),
  _Tab('nav.deals', Icons.handshake_outlined, () => const DealsScreen(), needsSignIn: true),
  _Tab('nav.me', Icons.person_outline, () => const AccountScreen()),
];

/// Bottom-navigation shell. Signed-out people see Prices, Market and Account (sign-in).
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  String _current = 'nav.prices';

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final tabs = [for (final t in _tabs) if (!t.needsSignIn || state.signedIn) t];
    var index = tabs.indexWhere((t) => t.labelKey == _current);
    if (index < 0) index = 0;
    final tab = tabs[index];
    final title = tab.labelKey == 'nav.me' && !state.signedIn ? s.t('nav.login') : s.t(tab.labelKey);
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          Tooltip(
            message: s.t('lang.switchHint'),
            child: TextButton(
              key: const Key('language-toggle'),
              onPressed: () => state.setLanguage(state.lang == 'ta' ? 'en' : 'ta'),
              child: Text(s.t('lang.switch')),
            ),
          ),
        ],
      ),
      // Keyed by tab, language and user so data reloads in the right language and session.
      body: SafeArea(child: KeyedSubtree(key: ValueKey('${tab.labelKey}-${state.lang}-${state.me?.userId}'), child: tab.builder())),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => setState(() => _current = tabs[i].labelKey),
        destinations: [
          for (final t in tabs)
            NavigationDestination(icon: Icon(t.icon), label: t.labelKey == 'nav.me' && !state.signedIn ? s.t('nav.login') : s.t(t.labelKey)),
        ],
      ),
    );
  }
}
