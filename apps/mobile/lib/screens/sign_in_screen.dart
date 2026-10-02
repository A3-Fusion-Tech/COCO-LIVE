import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/api_client.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';

/// Phone OTP sign-in: `/v1/auth/otp/request`, then `/v1/auth/otp/verify`. The bearer token
/// returned goes straight into the platform keystore (see `SecureTokenStore`).
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key, this.popOnSuccess = false});

  /// When pushed as a route, pop with `true` after signing in.
  final bool popOnSuccess;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _phoneForm = GlobalKey<FormState>();
  final _codeForm = GlobalKey<FormState>();
  bool _codeSent = false;
  bool _busy = false;
  String? _error;
  // One key per attempt so a retried tap after a dropped connection is not double-counted.
  String? _requestKey;
  String? _verifyKey;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (!_phoneForm.currentState!.validate()) return;
    final state = AppScope.read(context);
    _requestKey ??= newIdempotencyKey();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await state.api.requestOtp(_phone.text.trim(), idempotencyKey: _requestKey);
      _requestKey = null;
      if (!mounted) return;
      setState(() => _codeSent = true);
      showSnack(context, state.strings.t('login.sent'));
    } catch (e) {
      if (mounted) setState(() => _error = problemMessage(state.strings, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    if (!_codeForm.currentState!.validate()) return;
    final state = AppScope.read(context);
    _verifyKey ??= newIdempotencyKey();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await state.api.verifyOtp(_phone.text.trim(), _code.text.trim(), idempotencyKey: _verifyKey);
      _verifyKey = null;
      await state.signedInWith(result);
      if (!mounted) return;
      showSnack(context, state.strings.t('login.done'));
      if (widget.popOnSuccess) Navigator.of(context).pop(true);
    } catch (e) {
      _verifyKey = null; // a wrong code is a new attempt
      if (mounted) setState(() => _error = problemMessage(state.strings, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final body = ListView(padding: const EdgeInsets.all(16), children: [
      Text(s.t('login.title'), style: Theme.of(context).textTheme.headlineSmall),
      if (state.sessionExpired) ...[const SizedBox(height: 12), InfoNote(s.t('err.session'), warning: true)],
      const SizedBox(height: 16),
      Form(
        key: _phoneForm,
        child: TextFormField(
          key: const Key('phone'),
          controller: _phone,
          enabled: !_codeSent && !_busy,
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumber],
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]'))],
          decoration: InputDecoration(labelText: s.t('login.phone'), hintText: s.t('login.phoneHint')),
          validator: (v) => (v ?? '').replaceAll(RegExp(r'[^0-9]'), '').length < 10 ? s.t('common.required') : null,
        ),
      ),
      const SizedBox(height: 12),
      if (!_codeSent)
        FilledButton(key: const Key('send-code'), onPressed: _busy ? null : _send, child: Text(s.t('login.send')))
      else ...[
        Form(
          key: _codeForm,
          child: TextFormField(
            key: const Key('code'),
            controller: _code,
            enabled: !_busy,
            keyboardType: TextInputType.number,
            autofillHints: const [AutofillHints.oneTimeCode],
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
            decoration: InputDecoration(labelText: s.t('login.code')),
            validator: (v) => (v ?? '').length != 6 ? s.t('common.required') : null,
          ),
        ),
        const SizedBox(height: 12),
        FilledButton(key: const Key('verify'), onPressed: _busy ? null : _verify, child: Text(s.t('login.verify'))),
        TextButton(
          onPressed: _busy ? null : () => setState(() {
            _codeSent = false;
            _code.clear();
          }),
          child: Text(s.t('login.changeNumber')),
        ),
      ],
      if (_error != null) ...[
        const SizedBox(height: 12),
        Text(_error!, key: const Key('sign-in-error'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
      ],
    ]);
    if (!widget.popOnSuccess) return body;
    return Scaffold(appBar: AppBar(title: Text(s.t('nav.login'))), body: body);
  }
}
