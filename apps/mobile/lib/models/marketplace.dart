import 'json.dart';

/// `GET /v1/me` (and the `user` part of `/v1/auth/otp/verify`).
class Me {
  const Me({required this.userId, this.displayName = '', this.locale = 'ta', this.capabilities = const [], this.claims = const []});

  factory Me.fromJson(Json j) => Me(
        userId: str(j['userId']),
        displayName: str(j['displayName']),
        locale: str(j['locale'], 'ta'),
        capabilities: listOfStr(j['capabilities']),
        claims: [for (final c in listOfJson(j['claims'])) ClaimSummary.fromJson(c)],
      );

  final String userId;
  final String displayName;
  final String locale;
  final List<String> capabilities;
  final List<ClaimSummary> claims;

  /// Buyers need an identity or organisation claim before publishing requirements.
  bool get isVerifiedBuyer =>
      claims.any((c) => (c.type == 'PERSON_IDENTITY' || c.type == 'ORGANIZATION_EXISTENCE') && c.status == 'APPROVED');
}

class ClaimSummary {
  const ClaimSummary({required this.type, required this.status});

  factory ClaimSummary.fromJson(Json j) => ClaimSummary(type: str(j['type']), status: str(j['status'], 'APPROVED'));

  final String type;
  final String status;
}

/// A sell lot: the public market view (`GET /v1/sell-lots`) or the owner view (`/v1/me/sell-lots`).
class SellLot {
  const SellLot({
    required this.sellLotId,
    required this.productId,
    required this.gradeGroup,
    required this.unit,
    required this.quantityTotal,
    required this.quantityReserved,
    required this.quantityAvailable,
    required this.partialFulfilmentAllowed,
    required this.originMarketId,
    required this.availableFrom,
    required this.availableTo,
    required this.expiresAt,
    required this.fulfilmentMode,
    required this.costsIncluded,
    required this.costsExcluded,
    required this.status,
    required this.version,
    this.gradeAttributes = const {},
    this.unitPricePaise,
    this.photoCount = 0,
    this.verificationClaims = const [],
    this.listedOnBehalfOf,
  });

  factory SellLot.fromJson(Json j) {
    final fulfilment = asJson(j['fulfilment']);
    final price = asJson(j['priceExpectation']);
    return SellLot(
      sellLotId: str(j['sellLotId']),
      productId: str(j['productId']),
      gradeAttributes: {for (final e in asJson(j['gradeAttributes']).entries) e.key: '${e.value}'},
      gradeGroup: str(j['gradeGroup']),
      unit: str(j['unit']),
      quantityTotal: str(j['quantityTotal'], '0'),
      quantityReserved: str(j['quantityReserved'], '0'),
      quantityAvailable: str(j['quantityAvailable'], str(j['quantityTotal'], '0')),
      partialFulfilmentAllowed: boolOf(j['partialFulfilmentAllowed']),
      originMarketId: str(j['originMarketId']),
      availableFrom: str(j['availableFrom']),
      availableTo: str(j['availableTo']),
      expiresAt: str(j['expiresAt']),
      fulfilmentMode: str(fulfilment['mode'], 'PICKUP'),
      costsIncluded: listOfStr(fulfilment['costsIncluded']),
      costsExcluded: listOfStr(fulfilment['costsExcluded']),
      unitPricePaise: intOrNull(price['unitPricePaise']),
      photoCount: intOf(j['photoCount']),
      verificationClaims: [for (final c in listOfJson(j['verificationClaims'])) str(c['type'])],
      listedOnBehalfOf: strOrNull(j['listedOnBehalfOf']),
      status: str(j['status']),
      version: intOf(j['version'], 1),
    );
  }

  final String sellLotId;
  final String productId;
  final Map<String, String> gradeAttributes;
  final String gradeGroup;
  final String unit;
  final String quantityTotal;
  final String quantityReserved;
  final String quantityAvailable;
  final bool partialFulfilmentAllowed;
  final String originMarketId;
  final String availableFrom;
  final String availableTo;
  final String expiresAt;
  final String fulfilmentMode;
  final List<String> costsIncluded;
  final List<String> costsExcluded;
  final int? unitPricePaise;
  final int photoCount;
  final List<String> verificationClaims;
  final String? listedOnBehalfOf;
  final String status;
  final int version;

  bool get invitesOffers => unitPricePaise == null;
}

/// A buyer requirement (`/v1/me/buy-requirements`).
class BuyRequirement {
  const BuyRequirement({
    required this.requirementId,
    required this.productId,
    required this.unit,
    required this.gradeGroup,
    required this.targetQuantity,
    required this.minQuantity,
    required this.fulfilledQuantity,
    required this.destinationMarketId,
    required this.maxRadiusKm,
    required this.requiredFrom,
    required this.requiredBy,
    required this.expiresAt,
    required this.status,
    this.maxUnitPricePaise,
    this.recurrenceTemplateId,
  });

  factory BuyRequirement.fromJson(Json j) => BuyRequirement(
        requirementId: str(j['requirementId']),
        productId: str(j['productId']),
        unit: str(j['unit']),
        gradeGroup: str(j['gradeGroup']),
        targetQuantity: str(j['targetQuantity'], '0'),
        minQuantity: str(j['minQuantity'], '0'),
        fulfilledQuantity: str(j['fulfilledQuantity'], '0'),
        destinationMarketId: str(asJson(j['destination'])['marketId']),
        maxRadiusKm: intOf(j['maxRadiusKm']),
        requiredFrom: str(j['requiredFrom']),
        requiredBy: str(j['requiredBy']),
        expiresAt: str(j['expiresAt']),
        maxUnitPricePaise: intOrNull(j['maxUnitPricePaise']),
        recurrenceTemplateId: strOrNull(j['recurrenceTemplateId']),
        status: str(j['status']),
      );

  final String requirementId;
  final String productId;
  final String unit;
  final String gradeGroup;
  final String targetQuantity;
  final String minQuantity;
  final String fulfilledQuantity;
  final String destinationMarketId;
  final int maxRadiusKm;
  final String requiredFrom;
  final String requiredBy;
  final String expiresAt;
  final int? maxUnitPricePaise;
  final String? recurrenceTemplateId;
  final String status;

  bool get isOpen => status == 'ACTIVE' || status == 'DRAFT';
}

/// A lot ↔ requirement match with its explanation.
class MatchCandidate {
  const MatchCandidate({required this.sellLotId, required this.requirementId, required this.score, required this.reasons});

  factory MatchCandidate.fromJson(Json j) => MatchCandidate(
        sellLotId: str(j['sellLotId']),
        requirementId: str(j['requirementId']),
        score: (j['score'] is num) ? (j['score'] as num).toDouble() : 0,
        reasons: listOfStr(j['reasons']),
      );

  final String sellLotId;
  final String requirementId;
  final double score;
  final List<String> reasons;
}

/// Commercial terms of an offer or a deal card. The full JSON is kept so counter-offers and
/// amendments resend every term unchanged except the ones the person edits.
class OfferTerms {
  const OfferTerms(this.raw);

  final Json raw;

  String get quantity => str(raw['quantity'], '0');
  String get unit => str(raw['unit']);
  int get unitPricePaise => intOf(raw['unitPricePaise']);
  String get gradeGroup => str(raw['gradeGroup']);
  String get fulfilmentMode => str(raw['fulfilmentMode']);
  List<String> get costsIncluded => listOfStr(raw['costsIncluded']);
  List<String> get costsExcluded => listOfStr(raw['costsExcluded']);
  String get weighmentMethod => str(raw['weighmentMethod']);
  String get weighmentLocation => str(raw['weighmentLocation']);
  String get paymentMethod => str(raw['paymentMethod']);
  String get paymentDue => str(raw['paymentDue']);
  String get fulfilmentFrom => str(raw['fulfilmentFrom']);
  String get fulfilmentBy => str(raw['fulfilmentBy']);
  String get inspectionTerms => str(raw['inspectionTerms']);

  OfferTerms copyWith({String? quantity, int? unitPricePaise}) => OfferTerms({
        ...raw,
        'quantity': ?quantity,
        'unitPricePaise': ?unitPricePaise,
      });
}

/// Opening terms for an offer on [lot]: the lot's grade, fulfilment and costs, with the
/// buyer's quantity, price and payment/weighment choices (`POST /v1/offers` `terms`).
OfferTerms offerTermsForLot(
  SellLot lot, {
  required String quantity,
  required int unitPricePaise,
  required String paymentMethod,
  required String paymentDue,
  required String weighmentMethod,
  required String weighmentLocation,
  int acceptanceWindowHours = 24,
  String inspectionTerms = 'Buyer may inspect at loading',
}) =>
    OfferTerms({
      'quantity': quantity,
      'unit': lot.unit,
      'unitPricePaise': unitPricePaise,
      'gradeGroup': lot.gradeGroup,
      'fulfilmentMode': lot.fulfilmentMode,
      'costsIncluded': lot.costsIncluded,
      'costsExcluded': lot.costsExcluded,
      'weighmentMethod': weighmentMethod,
      'weighmentLocation': weighmentLocation,
      'paymentMethod': paymentMethod,
      'paymentDue': paymentDue,
      'fulfilmentFrom': lot.availableFrom,
      'fulfilmentBy': lot.availableTo,
      'acceptanceWindowHours': acceptanceWindowHours,
      'inspectionTerms': inspectionTerms,
    });

/// One revision in a negotiation thread (`GET /v1/offers`).
class Offer {
  const Offer({
    required this.offerId,
    required this.threadId,
    required this.revision,
    required this.sellLotId,
    required this.createdByPartyId,
    required this.sellerId,
    required this.buyerId,
    required this.terms,
    required this.estimatedTotalPaise,
    required this.expiresAt,
    required this.status,
    required this.version,
    required this.createdAt,
    this.previousOfferId,
  });

  factory Offer.fromJson(Json j) => Offer(
        offerId: str(j['offerId']),
        threadId: str(j['threadId'], str(j['offerId'])),
        revision: intOf(j['revision'], 1),
        previousOfferId: strOrNull(j['previousOfferId']),
        sellLotId: str(j['sellLotId']),
        createdByPartyId: str(j['createdByPartyId']),
        sellerId: str(j['sellerId']),
        buyerId: str(j['buyerId']),
        terms: OfferTerms(asJson(j['terms'])),
        estimatedTotalPaise: intOf(j['estimatedTotalPaise']),
        expiresAt: str(j['expiresAt']),
        status: str(j['status']),
        version: intOf(j['version'], 1),
        createdAt: str(j['createdAt']),
      );

  final String offerId;
  final String threadId;
  final int revision;
  final String? previousOfferId;
  final String sellLotId;
  final String createdByPartyId;
  final String sellerId;
  final String buyerId;
  final OfferTerms terms;
  final int estimatedTotalPaise;
  final String expiresAt;
  final String status;
  final int version;
  final String createdAt;

  bool get isActive => status == 'ACTIVE';
}

/// Offers grouped by `threadId`, oldest revision first.
class NegotiationThread {
  NegotiationThread(this.threadId, List<Offer> offers) : offers = [...offers]..sort((a, b) => a.revision.compareTo(b.revision));

  final String threadId;
  final List<Offer> offers;

  Offer get latest => offers.last;

  static List<NegotiationThread> group(List<Offer> offers) {
    final byThread = <String, List<Offer>>{};
    for (final o in offers) {
      byThread.putIfAbsent(o.threadId, () => []).add(o);
    }
    final threads = [for (final e in byThread.entries) NegotiationThread(e.key, e.value)];
    threads.sort((a, b) => b.latest.createdAt.compareTo(a.latest.createdAt));
    return threads;
  }
}

class DealCard {
  const DealCard({required this.revision, required this.terms, required this.totalPaise, required this.createdAt});

  factory DealCard.fromJson(Json j) => DealCard(
        revision: intOf(j['revision'], 1),
        terms: OfferTerms(asJson(j['terms'])),
        totalPaise: intOf(j['totalPaise']),
        createdAt: str(j['createdAt']),
      );

  final int revision;
  final OfferTerms terms;
  final int totalPaise;
  final String createdAt;
}

class DealEvent {
  const DealEvent({required this.seq, required this.type, required this.actorId, required this.at});

  factory DealEvent.fromJson(Json j) => DealEvent(seq: intOf(j['seq']), type: str(j['type']), actorId: str(j['actorId']), at: str(j['at']));

  final int seq;
  final String type;
  final String actorId;
  final String at;
}

class DealMilestone {
  const DealMilestone(this.key, this.done, this.at);

  final String key;
  final bool done;
  final String? at;
}

/// A deal with its immutable card revisions and append-only timeline (`/v1/deals/:id`).
class Deal {
  const Deal({
    required this.dealId,
    required this.sellLotId,
    required this.sellerId,
    required this.buyerId,
    required this.status,
    required this.cards,
    required this.events,
    required this.version,
    this.pendingAmendment,
    this.amendmentProposedBy,
    this.disputeId,
  });

  factory Deal.fromJson(Json j) {
    final pending = j['pendingAmendment'];
    return Deal(
      dealId: str(j['dealId']),
      sellLotId: str(j['sellLotId']),
      sellerId: str(j['sellerId']),
      buyerId: str(j['buyerId']),
      status: str(j['status']),
      cards: [for (final c in listOfJson(j['cards'])) DealCard.fromJson(c)],
      events: [for (final e in listOfJson(j['events'])) DealEvent.fromJson(e)],
      pendingAmendment: pending is Map ? OfferTerms(asJson(asJson(pending)['terms'])) : null,
      amendmentProposedBy: pending is Map ? strOrNull(asJson(pending)['proposedBy']) : null,
      disputeId: strOrNull(j['disputeId']),
      version: intOf(j['version'], 1),
    );
  }

  final String dealId;
  final String sellLotId;
  final String sellerId;
  final String buyerId;
  final String status;
  final List<DealCard> cards;
  final List<DealEvent> events;
  final OfferTerms? pendingAmendment;
  final String? amendmentProposedBy;
  final String? disputeId;
  final int version;

  DealCard? get card => cards.isEmpty ? null : cards.last;

  static const _milestoneEvents = {
    'AGREED': ['DEAL_CREATED'],
    'PICKUP': ['PICKUP_CONFIRMED'],
    'DELIVERED': ['DELIVERED'],
    'ACCEPTED': ['BUYER_ACCEPTED', 'DEEMED_ACCEPTED'],
    'PAID': ['PAYMENT_CONFIRMED'],
    'COMPLETED': ['COMPLETED'],
  };

  /// Fulfilment milestones derived from the event timeline, in order.
  List<DealMilestone> get milestones => [
        for (final m in _milestoneEvents.entries)
          () {
            final e = events.where((e) => m.value.contains(e.type)).firstOrNull;
            return DealMilestone(m.key, e != null || (m.key == 'AGREED' && cards.isNotEmpty), e?.at);
          }(),
      ];
}
