import 'package:flutter/material.dart';

import '../state/app_state.dart';
import '../widgets/common.dart';
import 'alerts_screen.dart';
import 'sign_in_screen.dart';

/// Sign-in when signed out; otherwise profile summary, language, alerts and sign-out.
class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final me = state.me;
    if (me == null) return const SignInScreen();
    return ListView(padding: const EdgeInsets.all(16), children: [
      Text(s.t('me.title'), style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 8),
      KeyValue(s.t('me.name'), me.displayName.isEmpty ? '—' : me.displayName),
      KeyValue('ID', me.userId),
      const SizedBox(height: 12),
      Text(s.t('me.claims'), style: Theme.of(context).textTheme.titleMedium),
      if (me.claims.isEmpty) Text(s.t('me.claimNone')),
      for (final c in me.claims) ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.verified_outlined), title: Text(c.type), subtitle: Text(s.status(c.status))),
      const SizedBox(height: 12),
      Text(s.t('me.language'), style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 4),
      SegmentedButton<String>(
        segments: const [ButtonSegment(value: 'ta', label: Text('தமிழ்')), ButtonSegment(value: 'en', label: Text('English'))],
        selected: {state.lang},
        onSelectionChanged: (v) => state.setLanguage(v.first),
      ),
      const SizedBox(height: 12),
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.notifications_outlined),
        title: Text(s.t('me.alerts')),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AlertsScreen())),
      ),
      const SizedBox(height: 8),
      InfoNote(s.t('me.webOnly')),
      const SizedBox(height: 16),
      FilledButton.tonal(onPressed: () => runAction(context, () => state.signOut()), child: Text(s.t('common.logout'))),
      const SizedBox(height: 8),
      TextButton(onPressed: () => runAction(context, () => state.signOut(everywhere: true)), child: Text(s.t('common.logoutAll'))),
    ]);
  }
}
