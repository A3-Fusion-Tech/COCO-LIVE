import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../models/marketplace.dart';
import '../state/app_state.dart';
import '../util/format.dart';
import '../widgets/common.dart';

/// Active sell lots (`GET /v1/sell-lots`, public, cursor-paginated). Making an offer needs sign-in.
class MarketScreen extends StatefulWidget {
  const MarketScreen({super.key});

  @override
  State<MarketScreen> createState() => _MarketScreenState();
}

class _MarketScreenState extends State<MarketScreen> {
  final List<SellLot> _lots = [];
  String? _cursor;
  bool _hasMore = false;
  bool _loading = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  Future<void> _load({bool reset = false}) async {
    final api = AppScope.read(context).api;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await api.marketLots(cursor: reset ? null : _cursor);
      if (!mounted) return;
      setState(() {
        if (reset) _lots.clear();
        _lots.addAll(page.items);
        _cursor = page.nextCursor;
        _hasMore = page.hasMore;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context).strings;
    if (_lots.isEmpty && _loading) return const Center(child: CircularProgressIndicator());
    if (_lots.isEmpty && _error != null) return ErrorPanel(message: problemMessage(s, _error!), onRetry: () => _load(reset: true));
    return RefreshIndicator(
      onRefresh: () => _load(reset: true),
      child: ListView(padding: const EdgeInsets.all(16), children: [
        Text(s.t('market.title'), style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        if (_lots.isEmpty) const EmptyState(),
        for (final lot in _lots) LotCard(lot: lot, onOffer: () => _offer(lot)),
        if (_error != null) Text(problemMessage(s, _error!), style: TextStyle(color: Theme.of(context).colorScheme.error)),
        if (_hasMore)
          Center(
            child: OutlinedButton(onPressed: _loading ? null : () => _load(), child: Text(s.t('common.loadMore'))),
          ),
      ]),
    );
  }

  Future<void> _offer(SellLot lot) async {
    if (!await ensureSignedIn(context) || !mounted) return;
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => MakeOfferScreen(lot: lot)));
  }
}

/// Summary of a lot for the market and the seller's own list.
class LotCard extends StatelessWidget {
  const LotCard({super.key, required this.lot, this.onOffer, this.actions = const []});

  final SellLot lot;
  final VoidCallback? onOffer;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final lang = state.lang;
    final unit = s.code('unit', lot.unit);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(state.catalog.productName(lot.productId, lang), style: Theme.of(context).textTheme.titleLarge)),
            StatusChip(lot.status),
          ]),
          Text('${lot.quantityAvailable} $unit ${s.t('market.available')}', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          KeyValue(s.t('sell.origin'), state.catalog.marketName(lot.originMarketId, lang)),
          KeyValue(s.t('sell.grade'), [lot.gradeGroup, for (final e in lot.gradeAttributes.entries) e.key == 'moisturePercent' ? '${s.t('sell.moisture')} ${e.value}' : s.code(e.key, e.value)].join(' · ')),
          KeyValue(s.t('sell.mode'), s.code('mode', lot.fulfilmentMode)),
          KeyValue(s.t('market.expected'),
              lot.invitesOffers ? s.t('market.invite') : '${formatInr(lot.unitPricePaise!, lang: lang)} / $unit'),
          if (lot.costsIncluded.isNotEmpty) KeyValue(s.t('term.costsIn'), lot.costsIncluded.map((c) => s.code('cost', c)).join(', ')),
          if (lot.costsExcluded.isNotEmpty) KeyValue(s.t('term.costsEx'), lot.costsExcluded.map((c) => s.code('cost', c)).join(', ')),
          KeyValue(s.t('market.expires'), formatDateTime(lot.expiresAt)),
          if (lot.verificationClaims.isNotEmpty) KeyValue(s.t('market.verified'), lot.verificationClaims.join(', ')),
          if (onOffer != null || actions.isNotEmpty) const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (onOffer != null) FilledButton(onPressed: onOffer, child: Text(s.t('market.offer'))),
            ...actions,
          ]),
        ]),
      ),
    );
  }
}

/// Buyer's opening offer on a lot (`POST /v1/offers`).
class MakeOfferScreen extends StatefulWidget {
  const MakeOfferScreen({super.key, required this.lot});

  final SellLot lot;

  @override
  State<MakeOfferScreen> createState() => _MakeOfferScreenState();
}

class _MakeOfferScreenState extends State<MakeOfferScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _qty = TextEditingController(text: widget.lot.quantityAvailable);
  late final TextEditingController _price =
      TextEditingController(text: widget.lot.unitPricePaise == null ? '' : paiseToInput(widget.lot.unitPricePaise!));
  final _hours = TextEditingController(text: '24');
  String _payment = 'UPI';
  String _due = 'ON_DELIVERY';
  String _weighment = 'COUNT';
  bool _busy = false;
  String? _key;

  @override
  void dispose() {
    _qty.dispose();
    _price.dispose();
    _hours.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    final state = AppScope.read(context);
    final lot = widget.lot;
    final terms = offerTermsForLot(
      lot,
      quantity: _qty.text.trim(),
      unitPricePaise: parseRupeesToPaise(_price.text)!,
      paymentMethod: _payment,
      paymentDue: _due,
      weighmentMethod: _weighment,
      weighmentLocation: state.catalog.marketName(lot.originMarketId, 'en'),
    );
    _key ??= newIdempotencyKey();
    setState(() => _busy = true);
    final ok = await runAction(
      context,
      () => state.api.createOffer(
        sellLotId: lot.sellLotId,
        terms: terms,
        expiresAt: DateTime.now().add(Duration(hours: int.parse(_hours.text.trim()))),
        idempotencyKey: _key,
      ),
      success: state.strings.t('market.sent'),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final lot = widget.lot;
    final unit = s.code('unit', lot.unit);
    return Scaffold(
      appBar: AppBar(title: Text(s.t('market.offer'))),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Text('${state.catalog.productName(lot.productId, state.lang)} — ${lot.quantityAvailable} $unit', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          TextFormField(
            controller: _qty,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: s.t('market.qty'), suffixText: unit),
            validator: requiredQuantity(s),
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _price,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: s.t('market.unitPrice'), prefixText: '₹ ', suffixText: '/ $unit'),
            validator: requiredAmount(s),
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _hours,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: s.t('market.validHours')),
            validator: (v) {
              final h = int.tryParse(v?.trim() ?? '');
              return h == null || h < 1 || h > 72 ? s.t('common.required') : null;
            },
          ),
          const SizedBox(height: 12),
          CodeDropdown(label: s.t('market.payment'), value: _payment, options: const ['UPI', 'CASH', 'BANK_TRANSFER'], labelOf: (v) => s.code('pay', v), onChanged: (v) => setState(() => _payment = v)),
          const SizedBox(height: 12),
          CodeDropdown(
              label: s.t('market.paymentDue'),
              value: _due,
              options: const ['ON_LOADING', 'ON_DELIVERY', 'WITHIN_3_DAYS', 'WITHIN_7_DAYS'],
              labelOf: (v) => s.code('due', v),
              onChanged: (v) => setState(() => _due = v)),
          const SizedBox(height: 12),
          CodeDropdown(label: s.t('market.weighment'), value: _weighment, options: const ['COUNT', 'SCALE', 'WEIGHBRIDGE'], labelOf: (v) => s.code('weigh', v), onChanged: (v) => setState(() => _weighment = v)),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy ? null : _submit, child: Text(s.t('market.offer'))),
        ]),
      ),
    );
  }
}
