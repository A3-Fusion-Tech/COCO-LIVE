import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../l10n/strings.dart';
import '../models/marketplace.dart';
import '../state/app_state.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import 'deal_screen.dart';

/// Negotiation threads (offers grouped by thread) and deals.
class DealsScreen extends StatelessWidget {
  const DealsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context).strings;
    return DefaultTabController(
      length: 2,
      child: Column(children: [
        TabBar(tabs: [Tab(text: s.t('offers.title')), Tab(text: s.t('deals.title'))]),
        const Expanded(child: TabBarView(children: [_ThreadsTab(), _DealsTab()])),
      ]),
    );
  }
}

String termsLine(S s, String lang, OfferTerms t) =>
    '${t.quantity} ${s.code('unit', t.unit)} @ ${formatInr(t.unitPricePaise, lang: lang)} / ${s.code('unit', t.unit)}';

class _ThreadsTab extends StatelessWidget {
  const _ThreadsTab();

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final me = state.me?.userId;
    return LoadView<List<NegotiationThread>>(
      reloadKey: state.lang,
      load: () async => NegotiationThread.group(await state.api.offers()),
      builder: (context, threads, reload) => ListView(padding: const EdgeInsets.all(16), children: [
        if (threads.isEmpty) const EmptyState(),
        for (final t in threads)
          Card(
            child: ListTile(
              minVerticalPadding: 12,
              title: Text(termsLine(s, state.lang, t.latest.terms)),
              subtitle: Text([
                t.latest.sellerId == me ? s.t('offers.asSeller') : s.t('offers.asBuyer'),
                '${s.t('offers.revision')} ${t.latest.revision}',
                s.status(t.latest.status),
              ].join(' · ')),
              trailing: const Icon(Icons.chevron_right),
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ThreadScreen(thread: t)));
                await reload();
              },
            ),
          ),
      ]),
    );
  }
}

class _DealsTab extends StatelessWidget {
  const _DealsTab();

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    return LoadView<List<Deal>>(
      reloadKey: state.lang,
      load: state.api.deals,
      builder: (context, deals, reload) => ListView(padding: const EdgeInsets.all(16), children: [
        if (deals.isEmpty) const EmptyState(),
        for (final d in deals.reversed)
          Card(
            child: ListTile(
              minVerticalPadding: 12,
              title: Text(d.card == null ? d.dealId : termsLine(s, state.lang, d.card!.terms)),
              subtitle: Text([
                d.sellerId == state.me?.userId ? s.t('deals.youSell') : s.t('deals.youBuy'),
                if (d.card != null) '${s.t('term.total')} ${formatInr(d.card!.totalPaise, lang: state.lang)}',
              ].join(' · ')),
              trailing: StatusChip(d.status),
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute(builder: (_) => DealScreen(dealId: d.dealId)));
                await reload();
              },
            ),
          ),
      ]),
    );
  }
}

/// One negotiation thread: every revision, oldest first, and the actions on the active one.
class ThreadScreen extends StatefulWidget {
  const ThreadScreen({super.key, required this.thread});

  final NegotiationThread thread;

  @override
  State<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends State<ThreadScreen> {
  late NegotiationThread _thread = widget.thread;
  bool _busy = false;

  Future<void> _reload() async {
    final api = AppScope.read(context).api;
    final all = await api.offers();
    if (!mounted) return;
    setState(() => _thread = NegotiationThread(_thread.threadId, all.where((o) => o.threadId == _thread.threadId).toList()));
  }

  Future<void> _act(Future<void> Function() action, {String? success}) async {
    setState(() => _busy = true);
    final ok = await runAction(context, action, success: success);
    if (ok) {
      try {
        await _reload();
      } catch (_) {
        // The list refreshes when the person goes back.
      }
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _accept(Offer offer) async {
    final state = AppScope.read(context);
    final s = state.strings;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(s.t('offers.confirmAccept')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(s.t('common.no'))),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(s.t('offers.accept'))),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    Deal? deal;
    await _act(() async => deal = await state.api.acceptOffer(offer), success: s.t('offers.accepted'));
    if (deal != null && deal!.dealId.isNotEmpty && mounted) {
      await Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => DealScreen(dealId: deal!.dealId)));
    }
  }

  Future<void> _counter(Offer offer) async {
    final state = AppScope.read(context);
    final s = state.strings;
    final result = await showDialog<(int, int)>(context: context, builder: (_) => _CounterDialog(offer: offer, s: s));
    if (result == null || !mounted) return;
    final key = newIdempotencyKey();
    await _act(
      () => state.api.counterOffer(offer, offer.terms.copyWith(unitPricePaise: result.$1), DateTime.now().add(Duration(hours: result.$2)), idempotencyKey: key),
      success: s.t('offers.countered'),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final lang = state.lang;
    final me = state.me?.userId;
    final latest = _thread.latest;
    final mine = latest.createdByPartyId == me;
    return Scaffold(
      appBar: AppBar(title: Text(s.t('offers.thread'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text(latest.sellerId == me ? s.t('offers.asSeller') : s.t('offers.asBuyer'), style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        for (final o in _thread.offers)
          Card(
            color: o.createdByPartyId == me ? Theme.of(context).colorScheme.primaryContainer : null,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text('${s.t('offers.revision')} ${o.revision} · ${o.createdByPartyId == me ? s.t('offers.byYou') : s.t('offers.byThem')}')),
                  StatusChip(o.status),
                ]),
                Text(termsLine(s, lang, o.terms), style: Theme.of(context).textTheme.titleMedium),
                KeyValue(s.t('offers.total'), formatInr(o.estimatedTotalPaise, lang: lang)),
                KeyValue(s.t('term.payment'), '${s.code('pay', o.terms.paymentMethod)} · ${s.code('due', o.terms.paymentDue)}'),
                KeyValue(s.t('term.weighment'), s.code('weigh', o.terms.weighmentMethod)),
                KeyValue(s.t('offers.expires'), formatDateTime(o.expiresAt)),
              ]),
            ),
          ),
        const SizedBox(height: 8),
        if (latest.isActive)
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (!mine) ...[
              FilledButton(onPressed: _busy ? null : () => _accept(latest), child: Text(s.t('offers.accept'))),
              OutlinedButton(onPressed: _busy ? null : () => _counter(latest), child: Text(s.t('offers.counter'))),
              TextButton(onPressed: _busy ? null : () => _act(() => state.api.rejectOffer(latest.offerId)), child: Text(s.t('offers.reject'))),
            ] else
              OutlinedButton(onPressed: _busy ? null : () => _act(() => state.api.withdrawOffer(latest.offerId)), child: Text(s.t('offers.withdraw'))),
          ]),
      ]),
    );
  }
}

class _CounterDialog extends StatefulWidget {
  const _CounterDialog({required this.offer, required this.s});

  final Offer offer;
  final S s;

  @override
  State<_CounterDialog> createState() => _CounterDialogState();
}

class _CounterDialogState extends State<_CounterDialog> {
  final _form = GlobalKey<FormState>();
  late final _price = TextEditingController(text: paiseToInput(widget.offer.terms.unitPricePaise));
  final _hours = TextEditingController(text: '24');

  @override
  void dispose() {
    _price.dispose();
    _hours.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.s;
    return AlertDialog(
      title: Text(s.t('offers.counter')),
      content: Form(
        key: _form,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextFormField(
            controller: _price,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: s.t('market.unitPrice'), prefixText: '₹ '),
            validator: requiredAmount(s),
          ),
          TextFormField(
            controller: _hours,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: s.t('market.validHours')),
            validator: (v) {
              final h = int.tryParse(v?.trim() ?? '');
              return h == null || h < 1 || h > 72 ? s.t('common.required') : null;
            },
          ),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(s.t('common.cancel'))),
        FilledButton(
          onPressed: () {
            if (_form.currentState!.validate()) {
              Navigator.pop(context, (parseRupeesToPaise(_price.text)!, int.parse(_hours.text.trim())));
            }
          },
          child: Text(s.t('offers.counter')),
        ),
      ],
    );
  }
}
