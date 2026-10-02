import 'package:flutter/material.dart';

import '../api/problem.dart';
import '../l10n/strings.dart';
import '../screens/sign_in_screen.dart';
import '../state/app_state.dart';
import '../util/format.dart';

/// Minimum touch target for every tappable control (larger than the 44px guideline).
const double minTouchTarget = 48;

/// Text for any error: the server's localised problem `message`, or a local fallback.
String problemMessage(S s, Object error) {
  if (error is ApiProblem) {
    if (error.isOffline) return s.t('err.offline');
    return error.displayMessage(s.t('err.generic'));
  }
  return s.t('err.generic');
}

void showSnack(BuildContext context, String text, {bool error = false}) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger == null) return;
  final scheme = Theme.of(context).colorScheme;
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(text, style: error ? TextStyle(color: scheme.onErrorContainer) : null),
      backgroundColor: error ? scheme.errorContainer : null,
    ));
}

/// Runs a mutation, shows the problem `message` on failure and [success] on success.
/// Returns true when the action succeeded.
Future<bool> runAction(BuildContext context, Future<void> Function() action, {String? success}) async {
  final s = AppScope.read(context).strings;
  try {
    await action();
    if (success != null && context.mounted) showSnack(context, success);
    return true;
  } catch (e) {
    if (context.mounted) showSnack(context, problemMessage(s, e), error: true);
    return false;
  }
}

/// Ensures a session, opening sign-in when needed. Returns true when signed in afterwards.
Future<bool> ensureSignedIn(BuildContext context) async {
  final state = AppScope.read(context);
  if (state.signedIn) return true;
  final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const SignInScreen(popOnSuccess: true)));
  return ok == true && state.signedIn;
}

/// Loads data with [load] and renders it with [builder]; handles loading, errors (with retry)
/// and pull-to-refresh. Reloads whenever [reloadKey] changes.
class LoadView<T> extends StatefulWidget {
  const LoadView({super.key, required this.load, required this.builder, this.reloadKey});

  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;
  final Object? reloadKey;

  @override
  State<LoadView<T>> createState() => _LoadViewState<T>();
}

class _LoadViewState<T> extends State<LoadView<T>> {
  T? _data;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void didUpdateWidget(covariant LoadView<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.reloadKey != widget.reloadKey) _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = _data == null;
      _error = null;
    });
    try {
      final data = await widget.load();
      if (!mounted) return;
      setState(() {
        _data = data;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context).strings;
    if (_loading) {
      return Center(child: Semantics(label: s.t('common.loading'), child: const CircularProgressIndicator()));
    }
    final data = _data;
    if (_error != null && data == null) {
      return ErrorPanel(message: problemMessage(s, _error!), onRetry: _reload);
    }
    return RefreshIndicator(
      onRefresh: _reload,
      child: Column(children: [
        if (_error != null) Padding(padding: const EdgeInsets.all(8), child: Text(problemMessage(s, _error!), style: TextStyle(color: Theme.of(context).colorScheme.error))),
        Expanded(child: widget.builder(context, data as T, _reload)),
      ]),
    );
  }
}

class ErrorPanel extends StatelessWidget {
  const ErrorPanel({super.key, required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context).strings;
    return ListView(padding: const EdgeInsets.all(24), children: [
      Icon(Icons.cloud_off, size: 48, color: Theme.of(context).colorScheme.error),
      const SizedBox(height: 12),
      Text(message, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyLarge),
      const SizedBox(height: 16),
      Center(child: FilledButton.tonal(onPressed: onRetry, child: Text(s.t('common.retry')))),
    ]);
  }
}

/// A highlighted, always-visible note (disclaimers, warnings).
class InfoNote extends StatelessWidget {
  const InfoNote(this.text, {super.key, this.icon = Icons.info_outline, this.warning = false});

  final String text;
  final IconData icon;
  final bool warning;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final bg = warning ? scheme.tertiaryContainer : scheme.secondaryContainer;
    final fg = warning ? scheme.onTertiaryContainer : scheme.onSecondaryContainer;
    return Semantics(
      container: true,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: fg),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: TextStyle(color: fg))),
        ]),
      ),
    );
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});

  final String status;

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context).strings;
    return Chip(label: Text(s.status(status)), visualDensity: VisualDensity.compact);
  }
}

/// A label/value row for cards.
class KeyValue extends StatelessWidget {
  const KeyValue(this.label, this.value, {super.key});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(flex: 2, child: Text(label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant))),
        const SizedBox(width: 8),
        Expanded(flex: 3, child: Text(value, style: Theme.of(context).textTheme.bodyLarge)),
      ]),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, this.text});

  final String? text;

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context).strings;
    return Padding(padding: const EdgeInsets.all(24), child: Text(text ?? s.t('common.none'), textAlign: TextAlign.center));
  }
}

/// A dropdown of codes with translated labels.
class CodeDropdown extends StatelessWidget {
  const CodeDropdown({super.key, required this.label, required this.value, required this.options, required this.labelOf, required this.onChanged});

  final String label;
  final String? value;
  final List<String> options;
  final String Function(String) labelOf;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: options.contains(value) ? value : null,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [for (final o in options) DropdownMenuItem(value: o, child: Text(labelOf(o), overflow: TextOverflow.ellipsis))],
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
    );
  }
}

/// A date chooser showing the chosen day (IST); keeps the time of day of [value].
class DateField extends StatelessWidget {
  const DateField({super.key, required this.label, required this.value, required this.onChanged});

  final String label;
  final DateTime value;
  final ValueChanged<DateTime> onChanged;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () async {
        final now = DateTime.now();
        final picked = await showDatePicker(
          context: context,
          initialDate: value.isBefore(now) ? now : value,
          firstDate: DateTime(now.year, now.month, now.day),
          lastDate: now.add(const Duration(days: 365)),
        );
        if (picked != null) {
          final local = value.toLocal();
          onChanged(DateTime(picked.year, picked.month, picked.day, local.hour, local.minute));
        }
      },
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: minTouchTarget),
        child: InputDecorator(
          decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.calendar_today)),
          child: Text(formatDate(value)),
        ),
      ),
    );
  }
}

/// Validators shared by forms.
String? Function(String?) requiredAmount(S s, {bool optional = false}) => (v) {
      final text = v?.trim() ?? '';
      if (text.isEmpty) return optional ? null : s.t('common.required');
      final paise = parseRupeesToPaise(text);
      return paise == null || paise <= 0 ? s.t('common.invalidAmount') : null;
    };

String? Function(String?) requiredQuantity(S s, {bool optional = false}) => (v) {
      final text = v?.trim() ?? '';
      if (text.isEmpty) return optional ? null : s.t('common.required');
      return isValidQuantity(text) ? null : s.t('common.invalidQuantity');
    };
