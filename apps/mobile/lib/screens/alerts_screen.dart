import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../models/price.dart';
import '../state/app_state.dart';
import '../util/format.dart';
import '../widgets/common.dart';

/// The signed-in user's price alerts with pause / resume / cancel (`/v1/alerts`).
class AlertsScreen extends StatelessWidget {
  const AlertsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    return Scaffold(
      appBar: AppBar(title: Text(s.t('alerts.title'))),
      body: LoadView<List<PriceAlert>>(
        reloadKey: state.lang,
        load: state.api.alerts,
        builder: (context, alerts, reload) => ListView(padding: const EdgeInsets.all(16), children: [
          if (alerts.isEmpty) const EmptyState(),
          for (final a in alerts)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${state.catalog.productName(a.productId, state.lang)} · ${state.catalog.marketName(a.marketId, state.lang)}',
                      style: Theme.of(context).textTheme.titleMedium),
                  Text([
                    s.code('stage', a.stage),
                    s.code('alerts', a.direction),
                    if (a.thresholdPaise != null) '${formatInr(a.thresholdPaise!, lang: state.lang)} / ${s.code('unit', a.unit)}',
                    s.code('channel', a.channel),
                  ].join(' · ')),
                  const SizedBox(height: 4),
                  StatusChip(a.status),
                  if (a.status != 'CANCELLED')
                    Wrap(spacing: 8, children: [
                      OutlinedButton(
                        onPressed: () async {
                          final next = a.status == 'PAUSED' ? 'ACTIVE' : 'PAUSED';
                          if (await runAction(context, () => state.api.setAlertStatus(a.alertId, next))) await reload();
                        },
                        child: Text(a.status == 'PAUSED' ? s.t('alerts.resume') : s.t('alerts.pause')),
                      ),
                      TextButton(
                        onPressed: () async {
                          if (await runAction(context, () => state.api.setAlertStatus(a.alertId, 'CANCELLED'))) await reload();
                        },
                        child: Text(s.t('alerts.cancel')),
                      ),
                    ]),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}

/// Creates an alert for one price bucket. Consent is an explicit, unticked-by-default checkbox
/// and the save button stays disabled until it is ticked.
class CreateAlertScreen extends StatefulWidget {
  const CreateAlertScreen({super.key, required this.price});

  final PricePoint price;

  @override
  State<CreateAlertScreen> createState() => _CreateAlertScreenState();
}

class _CreateAlertScreenState extends State<CreateAlertScreen> {
  final _form = GlobalKey<FormState>();
  final _threshold = TextEditingController();
  String _direction = 'ABOVE';
  String _channel = 'SMS';
  bool _consent = false;
  bool _busy = false;
  String? _key;

  @override
  void dispose() {
    _threshold.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    final state = AppScope.read(context);
    final p = widget.price;
    _key ??= newIdempotencyKey();
    setState(() => _busy = true);
    final ok = await runAction(
      context,
      () => state.api.createAlert(
        productId: p.productId,
        marketId: p.marketId,
        unit: p.range.perUnit,
        stage: p.stage,
        direction: _direction,
        channel: _channel,
        consent: _consent,
        thresholdPaise: _direction == 'BULLETIN' ? null : parseRupeesToPaise(_threshold.text),
        idempotencyKey: _key,
      ),
      success: state.strings.t('alerts.saved'),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final p = widget.price;
    return Scaffold(
      appBar: AppBar(title: Text(s.t('alerts.new'))),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Text('${p.product(state.lang)} · ${p.market(state.lang)} · ${s.code('stage', p.stage)}', style: Theme.of(context).textTheme.titleMedium),
          Text('${s.t('prices.reference')}: ${formatInr(p.range.referencePaise, lang: state.lang)} / ${s.code('unit', p.range.perUnit)}'),
          const SizedBox(height: 16),
          CodeDropdown(
            label: s.t('alerts.direction'),
            value: _direction,
            options: const ['ABOVE', 'BELOW', 'BULLETIN'],
            labelOf: (v) => s.code('alerts', v),
            onChanged: (v) => setState(() => _direction = v),
          ),
          if (_direction != 'BULLETIN') ...[
            const SizedBox(height: 12),
            TextFormField(
              controller: _threshold,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: s.t('alerts.threshold'), prefixText: '₹ '),
              validator: requiredAmount(s),
            ),
          ],
          const SizedBox(height: 12),
          CodeDropdown(
            label: s.t('alerts.channel'),
            value: _channel,
            options: const ['SMS', 'WHATSAPP', 'PUSH'],
            labelOf: (v) => s.code('channel', v),
            onChanged: (v) => setState(() => _channel = v),
          ),
          const SizedBox(height: 12),
          CheckboxListTile(
            key: const Key('alert-consent'),
            value: _consent,
            onChanged: (v) => setState(() => _consent = v ?? false),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
            title: Text(s.t('alerts.consent')),
          ),
          if (!_consent) Text(s.t('alerts.consentRequired'), style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 16),
          FilledButton(onPressed: _consent && !_busy ? _save : null, child: Text(s.t('common.save'))),
        ]),
      ),
    );
  }
}
