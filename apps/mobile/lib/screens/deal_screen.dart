import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../l10n/strings.dart';
import '../models/json.dart';
import '../models/marketplace.dart';
import '../state/app_state.dart';
import '../util/format.dart';
import '../widgets/common.dart';

/// Deal card (latest immutable revision), fulfilment milestones, role-based actions and the
/// append-only timeline (`/v1/deals/:id`).
class DealScreen extends StatefulWidget {
  const DealScreen({super.key, required this.dealId});

  final String dealId;

  @override
  State<DealScreen> createState() => _DealScreenState();
}

class _DealScreenState extends State<DealScreen> {
  int _generation = 0;
  bool _busy = false;

  Future<void> _action(String action, {Json body = const {}}) async {
    final state = AppScope.read(context);
    // One key per tap; the server collapses network retries of the same request.
    final key = newIdempotencyKey();
    setState(() => _busy = true);
    final ok = await runAction(context, () => state.api.dealAction(widget.dealId, action, body: body, idempotencyKey: key), success: state.strings.t('deals.updated'));
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (ok) _generation++;
    });
  }

  Future<String?> _ask(String title, String label, {String initial = ''}) {
    final s = AppScope.read(context).strings;
    final controller = TextEditingController(text: initial);
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(controller: controller, decoration: InputDecoration(labelText: label), autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(s.t('common.cancel'))),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: Text(s.t('common.submit'))),
        ],
      ),
    ).whenComplete(controller.dispose);
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    return Scaffold(
      appBar: AppBar(title: Text(s.t('deals.card'))),
      body: LoadView<Deal>(
        reloadKey: '${state.lang}-$_generation',
        load: () => state.api.deal(widget.dealId),
        builder: (context, deal, reload) => _body(context, s, state.lang, state.me?.userId, deal),
      ),
    );
  }

  Widget _body(BuildContext context, S s, String lang, String? me, Deal d) {
    final card = d.card;
    final terms = card?.terms;
    final seller = d.sellerId == me;
    final buyer = d.buyerId == me;
    final st = d.status;
    final theme = Theme.of(context);
    final actions = <Widget>[
      if (st == 'AGREED') FilledButton(onPressed: _busy ? null : () => _action('pickup'), child: Text(s.t('deals.pickup'))),
      if (seller && (st == 'AGREED' || st == 'PICKUP_CONFIRMED'))
        FilledButton(
          onPressed: _busy
              ? null
              : () async {
                  final qty = await _ask(s.t('deals.deliver'), s.t('deals.actualQty'), initial: terms?.quantity ?? '');
                  if (qty != null && qty.isNotEmpty) await _action('delivery', body: {'actualQuantity': qty});
                },
          child: Text(s.t('deals.deliver')),
        ),
      if (buyer && st == 'DELIVERED') FilledButton(onPressed: _busy ? null : () => _action('accept'), child: Text(s.t('deals.acceptDelivery'))),
      if (seller && st == 'ACCEPTED')
        FilledButton(onPressed: _busy ? null : () => _action('payment', body: {'method': terms?.paymentMethod ?? 'UPI'}), child: Text(s.t('deals.payment'))),
      if (st == 'PAYMENT_CONFIRMED') FilledButton(onPressed: _busy ? null : () => _action('complete'), child: Text(s.t('deals.complete'))),
      if (const ['AGREED', 'PICKUP_CONFIRMED', 'INSPECTION_PENDING'].contains(st))
        OutlinedButton(
          onPressed: _busy
              ? null
              : () async {
                  final reason = await _ask(s.t('deals.cancel'), s.t('common.reason'));
                  if (reason != null && reason.isNotEmpty) await _action('cancel', body: {'reason': reason});
                },
          child: Text(s.t('deals.cancel')),
        ),
    ];
    return ListView(padding: const EdgeInsets.all(16), children: [
      Row(children: [
        Expanded(child: Text(seller ? s.t('deals.youSell') : s.t('deals.youBuy'), style: theme.textTheme.titleMedium)),
        StatusChip(st),
      ]),
      const SizedBox(height: 8),
      InfoNote(s.t('deals.noGuarantee'), warning: true),
      const SizedBox(height: 12),
      if (card != null && terms != null)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${s.t('deals.card')} #${card.revision}', style: theme.textTheme.titleMedium),
              ..._termRows(s, lang, terms),
              KeyValue(s.t('term.total'), formatInr(card.totalPaise, lang: lang)),
            ]),
          ),
        ),
      if (d.pendingAmendment case final amendment?)
        Card(
          color: theme.colorScheme.tertiaryContainer,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(s.t('deals.amendment'), style: theme.textTheme.titleMedium),
              ..._termRows(s, lang, amendment),
              if (d.amendmentProposedBy != me)
                Wrap(spacing: 8, children: [
                  FilledButton(onPressed: _busy ? null : () => _action('amendments/respond', body: {'accept': true}), child: Text(s.t('deals.amendAccept'))),
                  OutlinedButton(onPressed: _busy ? null : () => _action('amendments/respond', body: {'accept': false}), child: Text(s.t('deals.amendReject'))),
                ]),
            ]),
          ),
        ),
      const SizedBox(height: 12),
      Text(s.t('deals.milestones'), style: theme.textTheme.titleMedium),
      for (final m in d.milestones)
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(m.done ? Icons.check_circle : Icons.radio_button_unchecked, color: m.done ? theme.colorScheme.primary : theme.colorScheme.outline),
          title: Text(s.code('milestone', m.key)),
          subtitle: m.at == null ? null : Text(formatDateTime(m.at)),
        ),
      if (actions.isNotEmpty) ...[const SizedBox(height: 8), Wrap(spacing: 8, runSpacing: 8, children: actions)],
      const SizedBox(height: 16),
      Text(s.t('deals.timeline'), style: theme.textTheme.titleMedium),
      for (final e in d.events.reversed)
        ListTile(contentPadding: EdgeInsets.zero, dense: true, title: Text(e.type), subtitle: Text(formatDateTime(e.at))),
    ]);
  }

  List<Widget> _termRows(S s, String lang, OfferTerms t) => [
        KeyValue(s.t('term.quantity'), '${t.quantity} ${s.code('unit', t.unit)}'),
        KeyValue(s.t('term.unitPrice'), '${formatInr(t.unitPricePaise, lang: lang)} / ${s.code('unit', t.unit)}'),
        KeyValue(s.t('term.payment'), '${s.code('pay', t.paymentMethod)} · ${s.code('due', t.paymentDue)}'),
        KeyValue(s.t('term.weighment'), '${s.code('weigh', t.weighmentMethod)} · ${t.weighmentLocation}'),
        KeyValue(s.t('term.fulfilment'), '${s.code('mode', t.fulfilmentMode)} · ${formatDateTime(t.fulfilmentFrom)} → ${formatDateTime(t.fulfilmentBy)}'),
        if (t.costsIncluded.isNotEmpty) KeyValue(s.t('term.costsIn'), t.costsIncluded.map((c) => s.code('cost', c)).join(', ')),
        if (t.costsExcluded.isNotEmpty) KeyValue(s.t('term.costsEx'), t.costsExcluded.map((c) => s.code('cost', c)).join(', ')),
        if (t.inspectionTerms.isNotEmpty) KeyValue(s.t('term.inspection'), t.inspectionTerms),
      ];
}
