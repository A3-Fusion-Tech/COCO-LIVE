import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../models/catalog.dart';
import '../state/app_state.dart';
import '../util/format.dart';
import '../widgets/common.dart';

const costCodes = ['HARVEST', 'DEHUSK', 'LOADING', 'TRANSPORT', 'COMMISSION', 'TAX'];

/// Product-specific grade attribute (what `validateLotForActivation` requires).
class _Attribute {
  const _Attribute(this.key, this.labelKey, this.options, this.initial);
  final String key;
  final String labelKey;
  final List<String>? options; // null: free numeric text
  final String initial;
}

const _attributes = {
  'husk': _Attribute('husk', 'sell.husk', ['WITH_HUSK', 'DEHUSKED'], 'WITH_HUSK'),
  'size': _Attribute('size', 'sell.size', ['SMALL', 'MEDIUM', 'LARGE'], 'MEDIUM'),
  'moisturePercent': _Attribute('moisturePercent', 'sell.moisture', null, '6'),
};

/// Creates a sell lot as a draft (`POST /v1/sell-lots`). Publishing happens from "My lots"
/// after a photo is added.
class CreateLotScreen extends StatefulWidget {
  const CreateLotScreen({super.key});

  @override
  State<CreateLotScreen> createState() => _CreateLotScreenState();
}

class _CreateLotScreenState extends State<CreateLotScreen> {
  final _form = GlobalKey<FormState>();
  final _quantity = TextEditingController();
  final _price = TextEditingController();
  final _grade = TextEditingController(text: 'FAQ');
  final _onBehalf = TextEditingController();
  final Map<String, TextEditingController> _attrText = {};
  final Map<String, String> _attrChoice = {};
  String? _productId;
  String? _unit;
  String? _origin;
  String _mode = 'PICKUP';
  final Set<String> _included = {'LOADING'};
  final Set<String> _excluded = {'TRANSPORT'};
  bool _partial = true;
  DateTime _from = DateTime.now().add(const Duration(minutes: 5));
  DateTime _to = DateTime.now().add(const Duration(days: 3));
  DateTime _expires = DateTime.now().add(const Duration(days: 7));
  bool _busy = false;
  String? _key;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final catalog = AppScope.of(context).catalog;
    if (_productId == null && catalog.products.isNotEmpty) _selectProduct(catalog.products.first);
    _origin ??= catalog.markets.isEmpty ? null : catalog.markets.first.marketId;
  }

  @override
  void dispose() {
    for (final c in [_quantity, _price, _grade, _onBehalf, ..._attrText.values]) {
      c.dispose();
    }
    super.dispose();
  }

  void _selectProduct(Product p) {
    _productId = p.productId;
    _unit = p.units.isEmpty ? null : p.units.first;
    for (final key in p.requiredAttributes) {
      final a = _attributes[key];
      if (a == null || a.options != null) {
        _attrChoice.putIfAbsent(key, () => a?.initial ?? '');
      } else {
        _attrText.putIfAbsent(key, () => TextEditingController(text: a.initial));
      }
    }
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    final state = AppScope.read(context);
    final product = state.catalog.product(_productId ?? '');
    if (product == null || _unit == null || _origin == null) return;
    final attrs = <String, String>{
      for (final key in product.requiredAttributes) key: _attrText[key]?.text.trim() ?? _attrChoice[key] ?? '',
    };
    final price = parseRupeesToPaise(_price.text);
    final body = <String, dynamic>{
      'productId': product.productId,
      'gradeAttributes': attrs,
      'gradeGroup': _grade.text.trim(),
      'unit': _unit,
      'quantityTotal': _quantity.text.trim(),
      'partialFulfilmentAllowed': _partial,
      'originMarketId': _origin,
      'availableFrom': toIso(_from),
      'availableTo': toIso(_to),
      'expiresAt': toIso(_expires),
      'fulfilment': {'mode': _mode, 'costsIncluded': _included.toList(), 'costsExcluded': _excluded.toList()},
      'priceExpectation': price == null ? {'inviteOffers': true} : {'unitPricePaise': price},
      if (_onBehalf.text.trim().isNotEmpty) 'listedOnBehalfOf': _onBehalf.text.trim(),
    };
    _key ??= newIdempotencyKey();
    setState(() => _busy = true);
    final ok = await runAction(context, () => state.api.createLot(body, idempotencyKey: _key), success: state.strings.t('sell.created'));
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final lang = state.lang;
    final catalog = state.catalog;
    final product = catalog.product(_productId ?? '');
    const gap = SizedBox(height: 12);
    return Scaffold(
      appBar: AppBar(title: Text(s.t('sell.new'))),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          CodeDropdown(
            label: s.t('sell.product'),
            value: _productId,
            options: [for (final p in catalog.products) p.productId],
            labelOf: (id) => catalog.productName(id, lang),
            onChanged: (id) => setState(() => _selectProduct(catalog.product(id)!)),
          ),
          for (final key in product?.requiredAttributes ?? const <String>[]) ...[
            gap,
            if (_attributes[key]?.options case final options?)
              CodeDropdown(key: ValueKey('attr-$_productId-$key'), label: s.t(_attributes[key]!.labelKey), value: _attrChoice[key], options: options, labelOf: (v) => s.code(key, v), onChanged: (v) => setState(() => _attrChoice[key] = v))
            else
              TextFormField(
                controller: _attrText[key] ??= TextEditingController(),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: s.t(_attributes[key]?.labelKey ?? key)),
                validator: (v) => (v ?? '').trim().isEmpty ? s.t('common.required') : null,
              ),
          ],
          gap,
          CodeDropdown(key: ValueKey('unit-$_productId'), label: s.t('sell.unit'), value: _unit, options: product?.units ?? const [], labelOf: (u) => s.code('unit', u), onChanged: (u) => setState(() => _unit = u)),
          gap,
          TextFormField(
            controller: _quantity,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: s.t('sell.quantity'), suffixText: _unit == null ? null : s.code('unit', _unit)),
            validator: requiredQuantity(s),
          ),
          gap,
          TextFormField(controller: _grade, decoration: InputDecoration(labelText: s.t('sell.grade')), validator: (v) => (v ?? '').trim().isEmpty ? s.t('common.required') : null),
          gap,
          CodeDropdown(label: s.t('sell.origin'), value: _origin, options: [for (final m in catalog.markets) m.marketId], labelOf: (id) => catalog.marketName(id, lang), onChanged: (v) => setState(() => _origin = v)),
          gap,
          TextFormField(
            controller: _price,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: s.t('sell.price'), helperText: s.t('sell.priceHint'), prefixText: '₹ '),
            validator: requiredAmount(s, optional: true),
          ),
          gap,
          DateField(label: s.t('sell.from'), value: _from, onChanged: (v) => setState(() => _from = v)),
          gap,
          DateField(label: s.t('sell.to'), value: _to, onChanged: (v) => setState(() => _to = v)),
          gap,
          DateField(label: s.t('sell.expires'), value: _expires, onChanged: (v) => setState(() => _expires = v)),
          gap,
          Text(s.t('sell.mode'), style: Theme.of(context).textTheme.titleSmall),
          SegmentedButton<String>(
            segments: [ButtonSegment(value: 'PICKUP', label: Text(s.t('sell.pickup'))), ButtonSegment(value: 'DELIVERY', label: Text(s.t('sell.delivery')))],
            selected: {_mode},
            onSelectionChanged: (v) => setState(() => _mode = v.first),
          ),
          gap,
          Text(s.t('sell.costsIn'), style: Theme.of(context).textTheme.titleSmall),
          _CostChips(selected: _included, other: _excluded, onChanged: () => setState(() {})),
          gap,
          Text(s.t('sell.costsEx'), style: Theme.of(context).textTheme.titleSmall),
          _CostChips(selected: _excluded, other: _included, onChanged: () => setState(() {})),
          gap,
          SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(s.t('sell.partial')), value: _partial, onChanged: (v) => setState(() => _partial = v)),
          TextFormField(controller: _onBehalf, decoration: InputDecoration(labelText: '${s.t('sell.listedFor')} (${s.t('common.optional')})')),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy || product == null ? null : _submit, child: Text(s.t('common.create'))),
        ]),
      ),
    );
  }
}

/// Cost chips; a cost can be either included or excluded, never both.
class _CostChips extends StatelessWidget {
  const _CostChips({required this.selected, required this.other, required this.onChanged});

  final Set<String> selected;
  final Set<String> other;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context).strings;
    return Wrap(spacing: 8, runSpacing: 4, children: [
      for (final c in costCodes)
        FilterChip(
          label: Text(s.code('cost', c)),
          selected: selected.contains(c),
          onSelected: (on) {
            if (on) {
              selected.add(c);
              other.remove(c);
            } else {
              selected.remove(c);
            }
            onChanged();
          },
        ),
    ]);
  }
}
