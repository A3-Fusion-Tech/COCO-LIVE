import 'package:flutter/material.dart';

import '../l10n/strings.dart';
import '../models/price.dart';
import '../state/app_state.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import 'alerts_screen.dart';
import 'evidence_screen.dart';

class _BoardData {
  const _BoardData(this.board, this.msp);
  final PriceBoard board;
  final List<MspReference> msp;
}

/// Public price board (no sign-in needed): latest low/reference/high ranges with freshness and
/// confidence as words, the "not an offer" disclaimer, evidence and MSP.
class PricesScreen extends StatelessWidget {
  const PricesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    return LoadView<_BoardData>(
      reloadKey: state.lang,
      load: () async {
        final results = await Future.wait([state.api.latestPrices(), state.api.msp()]);
        return _BoardData(results[0] as PriceBoard, results[1] as List<MspReference>);
      },
      builder: (context, data, reload) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          InfoNote(s.t('prices.disclaimer'), key: const Key('disclaimer'), icon: Icons.gavel_outlined, warning: true),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: () async {
                if (await ensureSignedIn(context) && context.mounted) {
                  Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AlertsScreen()));
                }
              },
              icon: const Icon(Icons.notifications_outlined),
              label: Text(s.t('prices.myAlerts')),
            ),
          ),
          if (data.board.items.isEmpty) EmptyState(text: s.t('prices.none')),
          for (final p in data.board.items) PriceCard(price: p),
          const SizedBox(height: 16),
          _MspSection(items: data.msp),
        ],
      ),
    );
  }
}

class PriceCard extends StatelessWidget {
  const PriceCard({super.key, required this.price});

  final PricePoint price;

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final lang = state.lang;
    final theme = Theme.of(context);
    final p = price;
    final unit = s.code('unit', p.range.perUnit);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${p.product(lang)} · ${p.market(lang)}', style: theme.textTheme.titleLarge),
          const SizedBox(height: 4),
          Text('${s.code('stage', p.stage)} · ${s.code('term', p.tradeTerm)} · ${p.gradeGroup} · ${s.t('prices.per')} $unit',
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: 12),
          Row(children: [
            _RangeCell(label: s.t('prices.low'), paise: p.range.lowPaise, lang: lang),
            _RangeCell(label: s.t('prices.reference'), paise: p.range.referencePaise, lang: lang, emphasis: true),
            _RangeCell(label: s.t('prices.high'), paise: p.range.highPaise, lang: lang),
          ]),
          const SizedBox(height: 12),
          KeyValue(s.t('prices.freshness'), s.code('fresh', p.freshness)),
          KeyValue(s.t('prices.confidence'), s.code('conf', p.confidence)),
          KeyValue(s.t('prices.reported'), formatDateTime(p.observedAt)),
          KeyValue(s.t('prices.basis'), evidenceSentence(s, p.evidence)),
          if (p.messageKey != null) ...[
            const SizedBox(height: 8),
            InfoNote(s.t(p.messageKey!), icon: Icons.warning_amber_outlined, warning: true),
          ],
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (p.hasEvidence)
              OutlinedButton.icon(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => EvidenceScreen(price: p))),
                icon: const Icon(Icons.fact_check_outlined),
                label: Text(s.t('prices.evidence')),
              ),
            OutlinedButton.icon(
              onPressed: () async {
                if (await ensureSignedIn(context) && context.mounted) {
                  Navigator.of(context).push(MaterialPageRoute(builder: (_) => CreateAlertScreen(price: p)));
                }
              },
              icon: const Icon(Icons.add_alert_outlined),
              label: Text(s.t('prices.alert')),
            ),
          ]),
        ]),
      ),
    );
  }
}

/// "8 observations, 5 independent organizations, ..." in the UI language.
String evidenceSentence(S s, EvidenceSummary e) => [
      '${e.observations} ${s.t('prices.observations')}',
      '${e.independentOrganizations} ${s.t('prices.organizations')}',
      if (e.officialMarketObservations > 0) '${e.officialMarketObservations} ${s.t('prices.official')}',
      if (e.verifiedQuotes > 0) '${e.verifiedQuotes} ${s.t('prices.quotes')}',
      if (e.completedTrades > 0) '${e.completedTrades} ${s.t('prices.trades')}',
    ].join(', ');

class _RangeCell extends StatelessWidget {
  const _RangeCell({required this.label, required this.paise, required this.lang, this.emphasis = false});

  final String label;
  final int paise;
  final String lang;
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Semantics(
        label: '$label ${formatInr(paise, lang: lang)}',
        excludeSemantics: true,
        child: Column(children: [
          Text(label, style: theme.textTheme.labelLarge),
          Text(formatInr(paise, lang: lang), style: emphasis ? theme.textTheme.headlineSmall : theme.textTheme.titleMedium),
        ]),
      ),
    );
  }
}

class _MspSection extends StatelessWidget {
  const _MspSection({required this.items});

  final List<MspReference> items;

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    if (items.isEmpty) return const SizedBox.shrink();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(s.t('prices.mspTitle'), style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(s.t('prices.msp')),
          const SizedBox(height: 8),
          for (final m in items)
            KeyValue(state.catalog.productName(m.productId, state.lang),
                '${formatInr(m.amountPaise, lang: state.lang)} / ${s.code('unit', m.unit)} — ${m.seasonLabel}'),
        ]),
      ),
    );
  }
}
