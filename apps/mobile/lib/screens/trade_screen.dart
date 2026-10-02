import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../models/marketplace.dart';
import '../state/app_state.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import 'create_lot_screen.dart';
import 'create_requirement_screen.dart';
import 'market_screen.dart';

/// Signed-in seller and buyer workspace: my sell lots and my buy requirements.
class TradeScreen extends StatelessWidget {
  const TradeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context).strings;
    return DefaultTabController(
      length: 2,
      child: Column(children: [
        TabBar(tabs: [Tab(text: s.t('trade.myLots')), Tab(text: s.t('trade.buy'))]),
        const Expanded(child: TabBarView(children: [MyLotsTab(), MyRequirementsTab()])),
      ]),
    );
  }
}

class MyLotsTab extends StatefulWidget {
  const MyLotsTab({super.key});

  @override
  State<MyLotsTab> createState() => _MyLotsTabState();
}

class _MyLotsTabState extends State<MyLotsTab> {
  int _generation = 0;

  void _refresh() => setState(() => _generation++);

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'new-lot',
        onPressed: () async {
          final created = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const CreateLotScreen()));
          if (created == true) _refresh();
        },
        icon: const Icon(Icons.add),
        label: Text(s.t('sell.new')),
      ),
      body: LoadView<List<SellLot>>(
        reloadKey: '${state.lang}-$_generation',
        load: state.api.myLots,
        builder: (context, lots, reload) => ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 96), children: [
          if (lots.isEmpty) const EmptyState(),
          for (final lot in lots.reversed)
            LotCard(lot: lot, actions: [
              Text('${s.t('sell.reserved')}: ${lot.quantityReserved} · ${s.t('sell.photos')}: ${lot.photoCount}'),
              if (['DRAFT', 'PENDING_REVIEW', 'ACTIVE'].contains(lot.status))
                OutlinedButton.icon(onPressed: () => _addPhoto(lot, reload), icon: const Icon(Icons.photo_camera_outlined), label: Text(s.t('sell.photo'))),
              if (lot.status == 'DRAFT')
                FilledButton(
                  onPressed: () async {
                    if (await runAction(context, () => state.api.activateLot(lot.sellLotId))) await reload();
                  },
                  child: Text(s.t('sell.activate')),
                ),
              if (['DRAFT', 'ACTIVE', 'PENDING_REVIEW'].contains(lot.status))
                TextButton(
                  onPressed: () async {
                    if (await runAction(context, () => state.api.withdrawLot(lot.sellLotId))) await reload();
                  },
                  child: Text(s.t('sell.withdraw')),
                ),
            ]),
        ]),
      ),
    );
  }

  Future<void> _addPhoto(SellLot lot, Future<void> Function() reload) async {
    final state = AppScope.read(context);
    final file = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 2000, imageQuality: 80);
    if (file == null || !mounted) return;
    final bytes = await file.readAsBytes();
    final name = file.name.toLowerCase();
    final type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    if (!mounted) return;
    if (await runAction(context, () => state.api.uploadLotPhoto(lot.sellLotId, bytes, type), success: state.strings.t('sell.photoOk'))) {
      await reload();
    }
  }
}

class MyRequirementsTab extends StatefulWidget {
  const MyRequirementsTab({super.key});

  @override
  State<MyRequirementsTab> createState() => _MyRequirementsTabState();
}

class _MyRequirementsTabState extends State<MyRequirementsTab> {
  int _generation = 0;
  final Map<String, List<MatchCandidate>> _matches = {};

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final s = state.strings;
    final lang = state.lang;
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'new-requirement',
        onPressed: () async {
          final created = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => const CreateRequirementScreen()));
          if (created == true) setState(() => _generation++);
        },
        icon: const Icon(Icons.add),
        label: Text(s.t('buy.new')),
      ),
      body: LoadView<List<BuyRequirement>>(
        reloadKey: '$lang-$_generation',
        load: state.api.myRequirements,
        builder: (context, reqs, reload) => ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 96), children: [
          if (!(state.me?.isVerifiedBuyer ?? false)) ...[InfoNote(s.t('buy.verifyFirst'), warning: true), const SizedBox(height: 12)],
          if (reqs.isEmpty) const EmptyState(),
          for (final r in reqs.reversed)
            Card(
              margin: const EdgeInsets.only(bottom: 12),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(state.catalog.productName(r.productId, lang), style: Theme.of(context).textTheme.titleLarge)),
                    StatusChip(r.status),
                  ]),
                  KeyValue(s.t('buy.target'), '${r.targetQuantity} ${s.code('unit', r.unit)} (${s.t('buy.min')}: ${r.minQuantity})'),
                  KeyValue(s.t('buy.dest'), '${state.catalog.marketName(r.destinationMarketId, lang)} · ${r.maxRadiusKm} km'),
                  KeyValue(s.t('buy.by'), formatDateTime(r.requiredBy)),
                  if (r.maxUnitPricePaise != null) KeyValue(s.t('buy.maxPrice'), formatInr(r.maxUnitPricePaise!, lang: lang)),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    OutlinedButton(
                      onPressed: () => runAction(context, () async {
                        final m = await state.api.requirementMatches(r.requirementId);
                        if (mounted) setState(() => _matches[r.requirementId] = m);
                      }),
                      child: Text(s.t('buy.matches')),
                    ),
                    if (r.isOpen)
                      TextButton(
                        onPressed: () async {
                          if (await runAction(context, () => state.api.closeRequirement(r.requirementId))) await reload();
                        },
                        child: Text(s.t('buy.close')),
                      ),
                  ]),
                  if (_matches[r.requirementId] case final matches?) ...[
                    const Divider(),
                    if (matches.isEmpty) const EmptyState(),
                    for (final m in matches)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(m.sellLotId),
                        subtitle: Text('${s.t('buy.score')} ${m.score.toStringAsFixed(2)} · ${m.reasons.join(', ')}'),
                      ),
                  ],
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}
