import 'json.dart';

/// Evidence counts behind a published range.
class EvidenceSummary {
  const EvidenceSummary({
    this.observations = 0,
    this.independentOrganizations = 0,
    this.officialMarketObservations = 0,
    this.verifiedQuotes = 0,
    this.completedTrades = 0,
  });

  factory EvidenceSummary.fromJson(Object? v) {
    final j = asJson(v);
    return EvidenceSummary(
      observations: intOf(j['observations']),
      independentOrganizations: intOf(j['independentOrganizations']),
      officialMarketObservations: intOf(j['officialMarketObservations']),
      verifiedQuotes: intOf(j['verifiedQuotes']),
      completedTrades: intOf(j['completedTrades']),
    );
  }

  final int observations;
  final int independentOrganizations;
  final int officialMarketObservations;
  final int verifiedQuotes;
  final int completedTrades;
}

/// A low / reference / high range in paise per unit.
class PriceRange {
  const PriceRange({required this.lowPaise, required this.referencePaise, required this.highPaise, required this.perUnit});

  factory PriceRange.fromJson(Object? v) {
    final j = asJson(v);
    int paise(String k) => intOf(asJson(j[k])['amountPaise']);
    return PriceRange(lowPaise: paise('low'), referencePaise: paise('reference'), highPaise: paise('high'), perUnit: str(j['perUnit']));
  }

  final int lowPaise;
  final int referencePaise;
  final int highPaise;
  final String perUnit;
}

/// One row of `GET /v1/prices/latest`.
class PricePoint {
  const PricePoint({
    required this.kind,
    required this.productId,
    required this.productName,
    required this.productNameTa,
    required this.marketId,
    required this.marketName,
    required this.marketNameTa,
    required this.stage,
    required this.tradeTerm,
    required this.gradeGroup,
    required this.range,
    required this.observedAt,
    required this.freshness,
    required this.confidence,
    required this.evidence,
    this.priceAggregateId,
    this.messageKey,
    this.calculationVersion,
  });

  factory PricePoint.fromJson(Json j) {
    final product = asJson(j['product']);
    final market = asJson(j['market']);
    return PricePoint(
      priceAggregateId: strOrNull(j['priceAggregateId']),
      kind: str(j['kind'], 'AGGREGATE'),
      productId: str(product['productId']),
      productName: str(product['name']),
      productNameTa: str(product['nameTa'], str(product['name'])),
      marketId: str(market['marketId']),
      marketName: str(market['name']),
      marketNameTa: str(market['nameTa'], str(market['name'])),
      stage: str(j['stage']),
      tradeTerm: str(j['tradeTerm']),
      gradeGroup: str(j['gradeGroup']),
      range: PriceRange.fromJson(j['range']),
      observedAt: strOrNull(asJson(j['observedWindow'])['endsAt']),
      freshness: str(j['freshness'], 'STALE'),
      confidence: str(j['confidence'], 'LOW'),
      messageKey: strOrNull(j['messageKey']),
      evidence: EvidenceSummary.fromJson(j['evidenceSummary']),
      calculationVersion: strOrNull(j['calculationVersion']),
    );
  }

  final String? priceAggregateId;
  final String kind;
  final String productId;
  final String productName;
  final String productNameTa;
  final String marketId;
  final String marketName;
  final String marketNameTa;
  final String stage;
  final String tradeTerm;
  final String gradeGroup;
  final PriceRange range;
  final String? observedAt;
  final String freshness;
  final String confidence;
  final String? messageKey;
  final EvidenceSummary evidence;
  final String? calculationVersion;

  /// Only aggregates have a published evidence breakdown.
  bool get hasEvidence => kind == 'AGGREGATE';

  String product(String lang) => lang == 'ta' ? productNameTa : productName;
  String market(String lang) => lang == 'ta' ? marketNameTa : marketName;
}

class PriceBoard {
  const PriceBoard({required this.items, required this.disclaimerKey});

  factory PriceBoard.fromJson(Json j) => PriceBoard(
        items: [for (final i in listOfJson(j['items'])) PricePoint.fromJson(i)],
        disclaimerKey: str(j['disclaimerKey'], 'price.not_offer'),
      );

  final List<PricePoint> items;
  final String disclaimerKey;
}

class EvidenceObservation {
  const EvidenceObservation({required this.sourceClass, required this.observedAt, required this.range});

  factory EvidenceObservation.fromJson(Json j) =>
      EvidenceObservation(sourceClass: str(j['sourceClass']), observedAt: str(j['observedAt']), range: PriceRange.fromJson(j['range']));

  final String sourceClass;
  final String observedAt;
  final PriceRange range;
}

/// `GET /v1/prices/evidence`: contributor-anonymous inputs of one aggregate.
class PriceEvidence {
  const PriceEvidence({required this.calculationVersion, required this.calculatedAt, required this.summary, required this.observations});

  factory PriceEvidence.fromJson(Json j) => PriceEvidence(
        calculationVersion: str(j['calculationVersion']),
        calculatedAt: str(j['calculatedAt']),
        summary: EvidenceSummary.fromJson(j['evidenceSummary']),
        observations: [for (final o in listOfJson(j['observations'])) EvidenceObservation.fromJson(o)],
      );

  final String calculationVersion;
  final String calculatedAt;
  final EvidenceSummary summary;
  final List<EvidenceObservation> observations;
}

/// `GET /v1/prices/msp`: policy references, never market quotes.
class MspReference {
  const MspReference({required this.productId, required this.unit, required this.amountPaise, required this.seasonLabel});

  factory MspReference.fromJson(Json j) => MspReference(
        productId: str(j['productId']),
        unit: str(j['unit']),
        amountPaise: intOf(j['amountPaise']),
        seasonLabel: str(j['seasonLabel']),
      );

  final String productId;
  final String unit;
  final int amountPaise;
  final String seasonLabel;
}

/// A price alert subscription (`/v1/alerts`).
class PriceAlert {
  const PriceAlert({
    required this.alertId,
    required this.productId,
    required this.marketId,
    required this.unit,
    required this.stage,
    required this.direction,
    required this.channel,
    required this.status,
    this.thresholdPaise,
    this.consentAt,
  });

  factory PriceAlert.fromJson(Json j) => PriceAlert(
        alertId: str(j['alertId']),
        productId: str(j['productId']),
        marketId: str(j['marketId']),
        unit: str(j['unit']),
        stage: str(j['stage']),
        direction: str(j['direction']),
        thresholdPaise: intOrNull(j['thresholdPaise']),
        channel: str(j['channel']),
        consentAt: strOrNull(j['consentAt']),
        status: str(j['status']),
      );

  final String alertId;
  final String productId;
  final String marketId;
  final String unit;
  final String stage;
  final String direction;
  final int? thresholdPaise;
  final String channel;
  final String? consentAt;
  final String status;
}
