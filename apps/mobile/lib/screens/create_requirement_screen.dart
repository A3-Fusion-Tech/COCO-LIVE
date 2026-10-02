import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../state/app_state.dart';
import '../util/format.dart';
import '../widgets/common.dart';

/// Publishes a buy requirement, one-off or recurring (`POST /v1/buy-requirements[/recurring]`).
class CreateRequirementScreen extends StatefulWidget {
  const CreateRequirementScreen({super.key});

  @override
  State<CreateRequirementScreen> createState() => _CreateRequirementScreenState();
}

class _CreateRequirementScreenState extends State<CreateRequirementScreen> {
  final _form = GlobalKey<FormState>();
  final _target = TextEditingController();
  final _min = TextEditingController();
  final _grade = TextEditingController(text: 'FAQ');
  final _radius = TextEditingController(text: '40');
  final _maxPrice = TextEditingController();
  final _occurrences = TextEditingController(text: '4');
  String? _productId;
  String? _unit;
  String? _destination;
  String _repeat = '';
  bool _partial = true;
  DateTime _from = DateTime.now().add(const Duration(minutes: 5));
  DateTime _by = DateTime.now().add(const Duration(days: 7));
  DateTime _expires = DateTime.now().add(const Duration(days: 5));
  bool _busy = false;
  String? _key;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = AppScope.of(context).catalog;
    if (_productId == null && catalog.products.isNotEmpty) {
      _productId = catalog.products.first.productId;
      _unit = catalog.products.first.units.firstOrNull;
    }
    _destination ??= catalog.markets.firstOrNull?.marketId;
  }

  @override
  void dispose() {
    for (final c in [_target, _min, _grade, _radius, _maxPrice, _occurrences]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate() || _productId == null || _unit == null || _destination == null) return;
    final state = AppScope.read(context);
    final maxPrice = parseRupeesToPaise(_maxPrice.text);
    final body = <String, dynamic>{
      'productId': _productId,
      'gradeGroup': _grade.text.trim(),
      'unit': _unit,
      'targetQuantity': _target.text.trim(),
      'minQuantity': _min.text.trim().isEmpty ? _target.text.trim() : _min.text.trim(),
      'partialAllowed': _partial,
      'destinationMarketId': _destination,
      'maxRadiusKm': int.parse(_radius.text.trim()),
      'requiredFrom': toIso(_from),
      'requiredBy': toIso(_by),
      'expiresAt': toIso(_expires),
      'maxUnitPricePaise': ?maxPrice,
    };
    _key ??= newIdempotencyKey();
    setState(() => _busy = true);
    final ok = await runAction(
      context,
      () => state.api.createRequirement(body,
          cadence: _repeat.isEmpty ? null : _repeat, occurrences: int.tryParse(_occurrences.text.trim()), idempotencyKey: _key),
      success: state.strings.t('buy.created'),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final catalog = state.catalog;
    final product = catalog.product(_productId ?? '');
    const gap = SizedBox(height: 12);
    return Scaffold(
      appBar: AppBar(title: Text(s.t('buy.new'))),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          if (!(state.me?.isVerifiedBuyer ?? false)) ...[InfoNote(s.t('buy.verifyFirst'), warning: true), gap],
          CodeDropdown(
            label: s.t('sell.product'),
            value: _productId,
            options: [for (final p in catalog.products) p.productId],
            labelOf: (id) => catalog.productName(id, state.lang),
            onChanged: (id) => setState(() {
              _productId = id;
              _unit = catalog.product(id)?.units.firstOrNull;
            }),
          ),
          gap,
          CodeDropdown(key: ValueKey('unit-$_productId'), label: s.t('sell.unit'), value: _unit, options: product?.units ?? const [], labelOf: (u) => s.code('unit', u), onChanged: (u) => setState(() => _unit = u)),
          gap,
          TextFormField(controller: _target, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: s.t('buy.target')), validator: requiredQuantity(s)),
          gap,
          TextFormField(
            controller: _min,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: '${s.t('buy.min')} (${s.t('common.optional')})'),
            validator: requiredQuantity(s, optional: true),
          ),
          gap,
          TextFormField(controller: _grade, decoration: InputDecoration(labelText: s.t('sell.grade')), validator: (v) => (v ?? '').trim().isEmpty ? s.t('common.required') : null),
          gap,
          CodeDropdown(label: s.t('buy.dest'), value: _destination, options: [for (final m in catalog.markets) m.marketId], labelOf: (id) => catalog.marketName(id, state.lang), onChanged: (v) => setState(() => _destination = v)),
          gap,
          TextFormField(
            controller: _radius,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: s.t('buy.radius')),
            validator: (v) => (int.tryParse(v?.trim() ?? '') ?? 0) <= 0 ? s.t('common.required') : null,
          ),
          gap,
          DateField(label: s.t('buy.from'), value: _from, onChanged: (v) => setState(() => _from = v)),
          gap,
          DateField(label: s.t('buy.by'), value: _by, onChanged: (v) => setState(() => _by = v)),
          gap,
          DateField(label: s.t('sell.expires'), value: _expires, onChanged: (v) => setState(() => _expires = v)),
          gap,
          TextFormField(
            controller: _maxPrice,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: '${s.t('buy.maxPrice')} (${s.t('common.optional')})', prefixText: '₹ '),
            validator: requiredAmount(s, optional: true),
          ),
          gap,
          CodeDropdown(
            label: s.t('buy.recurring'),
            value: _repeat,
            options: const ['', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY'],
            labelOf: (v) => v.isEmpty ? s.t('buy.once') : s.code('cadence', v),
            onChanged: (v) => setState(() => _repeat = v),
          ),
          if (_repeat.isNotEmpty) ...[
            gap,
            TextFormField(
              controller: _occurrences,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: s.t('buy.occurrences')),
              validator: (v) {
                final n = int.tryParse(v?.trim() ?? '');
                return n == null || n < 2 || n > 52 ? s.t('common.required') : null;
              },
            ),
          ],
          SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(s.t('sell.partial')), value: _partial, onChanged: (v) => setState(() => _partial = v)),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy || product == null ? null : _submit, child: Text(s.t('common.create'))),
        ]),
      ),
    );
  }
}
