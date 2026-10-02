import 'package:flutter/material.dart';

import '../models/price.dart';
import '../state/app_state.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import 'prices_screen.dart';

/// Contributor-anonymous evidence behind one published range (`/v1/prices/evidence`).
class EvidenceScreen extends StatelessWidget {
  const EvidenceScreen({super.key, required this.price});

  final PricePoint price;

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final lang = state.lang;
    return Scaffold(
      appBar: AppBar(title: Text(s.t('evidence.title'))),
      body: LoadView<PriceEvidence>(
        reloadKey: lang,
        load: () => state.api.priceEvidence(productId: price.productId, marketId: price.marketId, unit: price.range.perUnit, stage: price.stage),
        builder: (context, ev, reload) => ListView(padding: const EdgeInsets.all(16), children: [
          Text('${price.product(lang)} · ${price.market(lang)}', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          InfoNote(s.t('prices.disclaimer'), icon: Icons.gavel_outlined, warning: true),
          const SizedBox(height: 8),
          KeyValue(s.t('evidence.calculated'), formatDateTime(ev.calculatedAt)),
          KeyValue(s.t('evidence.method'), ev.calculationVersion),
          KeyValue(s.t('prices.basis'), evidenceSentence(s, ev.summary)),
          const SizedBox(height: 8),
          Text(s.t('evidence.anonymous'), style: Theme.of(context).textTheme.bodySmall),
          const Divider(height: 24),
          for (final o in ev.observations)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.receipt_long_outlined),
              title: Text(s.code('source', o.sourceClass)),
              subtitle: Text(formatDateTime(o.observedAt)),
              trailing: Text('${formatInr(o.range.lowPaise, lang: lang)} – ${formatInr(o.range.highPaise, lang: lang)}'),
            ),
          if (ev.observations.isEmpty) const EmptyState(),
        ]),
      ),
    );
  }
}
