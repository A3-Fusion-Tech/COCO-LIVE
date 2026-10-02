import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:live_coco/api/api_client.dart';
import 'package:live_coco/api/problem.dart';
import 'package:live_coco/api/token_store.dart';
import 'package:live_coco/models/marketplace.dart';

import 'support.dart';

void main() {
  group('ApiClient transport', () {
    test('GET sends Accept-Language and ?lang=, no idempotency key, no auth when signed out', () async {
      final fake = FakeApi(publicRoutes());
      final api = fake.api()..language = 'ta';
      final board = await api.latestPrices(productId: 'prod_mature_coconut');

      final req = fake.seen.single;
      expect(req.method, 'GET');
      expect(req.request.url.queryParameters, {'productId': 'prod_mature_coconut', 'lang': 'ta'});
      expect(req.headers['accept-language'], 'ta');
      expect(req.headers.containsKey('idempotency-key'), isFalse);
      expect(req.headers.containsKey('authorization'), isFalse);
      expect(board.items, hasLength(2));
      expect(board.items.first.range.referencePaise, 3050);
      expect(board.items.first.product('ta'), 'முற்றிய தேங்காய்');
      expect(board.items.last.hasEvidence, isFalse);
      expect(board.disclaimerKey, 'price.not_offer');
    });

    test('verifyOtp stores the bearer token, which later requests send', () async {
      final tokens = MemoryTokenStore();
      final fake = FakeApi({
        'POST /v1/auth/otp/verify': (_) => json({
              'token': 'tok_abc',
              'user': {'userId': 'user_1', 'capabilities': [], 'locale': 'en'},
            }),
        'GET /v1/me': (_) => json({'userId': 'user_1', 'displayName': 'Murugan', 'locale': 'en', 'capabilities': [], 'claims': []}),
      });
      final api = fake.api(tokens: tokens)..language = 'en';

      final signedIn = await api.verifyOtp('+919000000001', '123456');
      expect(signedIn.userId, 'user_1');
      expect(tokens.token, 'tok_abc');
      expect(api.isSignedIn, isTrue);
      expect(fake.seen.first.body, {'phone': '+919000000001', 'code': '123456'});

      final me = await api.me();
      expect(me.displayName, 'Murugan');
      expect(fake.seen.last.headers['authorization'], 'Bearer tok_abc');
    });

    test('restoreSession reads the stored token', () async {
      final fake = FakeApi({'GET /v1/me': (_) => json({'userId': 'u'})});
      final api = fake.api(tokens: MemoryTokenStore('stored'));
      await api.restoreSession();
      await api.me();
      expect(fake.seen.single.headers['authorization'], 'Bearer stored');
    });

    test('every mutation sends an Idempotency-Key; a caller key is reused verbatim', () async {
      final fake = FakeApi({
        'POST /v1/alerts': (_) => json({'alertId': 'alert_1', 'status': 'ACTIVE', 'direction': 'ABOVE', 'channel': 'SMS'}, status: 201),
        'PATCH /v1/alerts/alert_1': (_) => json({'alertId': 'alert_1', 'status': 'PAUSED'}),
        'POST /v1/sell-lots/lot_1/activate': (_) => json({'sellLotId': 'lot_1', 'status': 'ACTIVE'}),
      });
      final api = fake.api(tokens: MemoryTokenStore('t'));
      await api.restoreSession();

      await api.createAlert(
        productId: 'prod_mature_coconut',
        marketId: 'market_pollachi',
        unit: 'NUT',
        stage: 'FARM_GATE',
        direction: 'ABOVE',
        channel: 'SMS',
        consent: true,
        thresholdPaise: 3100,
        idempotencyKey: 'key-1',
      );
      await api.setAlertStatus('alert_1', 'PAUSED');
      await api.activateLot('lot_1');

      expect(fake.seen[0].headers['idempotency-key'], 'key-1');
      expect(fake.seen[0].body, containsPair('consent', true));
      expect(fake.seen[0].body, containsPair('thresholdPaise', 3100));
      for (final s in fake.seen) {
        expect(s.headers['idempotency-key'], isNotEmpty, reason: '${s.method} ${s.path}');
        expect(s.headers['content-type'], startsWith('application/json'));
      }
      expect(fake.seen[1].headers['idempotency-key'], isNot(fake.seen[2].headers['idempotency-key']));
    });

    test('accepting an offer uses a key derived from the offer and sends If-Match', () async {
      final fake = FakeApi({
        'POST /v1/offers/offer_9/accept': (_) => json({'dealId': 'deal_1', 'status': 'AGREED', 'cards': [], 'events': []}, status: 201),
      });
      final api = fake.api();
      final offer = Offer.fromJson({'offerId': 'offer_9', 'threadId': 'neg_1', 'version': 3, 'terms': {}});
      final deal = await api.acceptOffer(offer);
      expect(deal.dealId, 'deal_1');
      expect(fake.seen.single.headers['idempotency-key'], 'accept-offer_9');
      expect(fake.seen.single.headers['if-match'], '"3"');
    });

    test('problem+json errors surface the localised message and field errors', () async {
      final fake = FakeApi({
        'POST /v1/sell-lots': (_) => problem(422, 'VALIDATION_FAILED', 'சில புலங்கள் தவறானவை', fieldErrors: [
              {'field': 'quantityTotal', 'code': 'INVALID'},
            ]),
      });
      final api = fake.api();
      await expectLater(
        api.createLot({'productId': 'x'}),
        throwsA(isA<ApiProblem>()
            .having((p) => p.status, 'status', 422)
            .having((p) => p.code, 'code', 'VALIDATION_FAILED')
            .having((p) => p.displayMessage('fallback'), 'displayMessage', 'சில புலங்கள் தவறானவை: quantityTotal')),
      );
    });

    test('a 401 on an authenticated call forgets the token and reports the expired session', () async {
      final tokens = MemoryTokenStore('old');
      final fake = FakeApi({'GET /v1/deals': (_) => problem(401, 'UNAUTHENTICATED', 'Authentication required')});
      final api = fake.api(tokens: tokens);
      var expired = 0;
      api.onSessionExpired = () => expired++;
      await api.restoreSession();

      await expectLater(api.deals(), throwsA(isA<ApiProblem>().having((p) => p.isUnauthenticated, '401', isTrue)));
      expect(tokens.token, isNull);
      expect(api.isSignedIn, isFalse);
      expect(expired, 1);
    });

    test('network failures become an OFFLINE problem', () async {
      final api = ApiClient(
        baseUrl: 'http://api.test/',
        tokens: MemoryTokenStore(),
        httpClient: _ThrowingClient(),
      );
      await expectLater(api.catalog(), throwsA(isA<ApiProblem>().having((p) => p.isOffline, 'offline', isTrue)));
    });

    test('non-JSON error bodies still produce a problem', () async {
      final fake = FakeApi({'GET /v1/catalog': (_) => http.Response('<html>bad gateway</html>', 502)});
      await expectLater(fake.api().catalog(), throwsA(isA<ApiProblem>().having((p) => p.code, 'code', 'HTTP_502')));
    });

    test('signOutEverywhere revokes server sessions and clears the keystore even if the call fails', () async {
      final tokens = MemoryTokenStore('t');
      final fake = FakeApi({'POST /v1/me/sessions/revoke-all': (_) => problem(503, 'UNAVAILABLE', 'Try again later')});
      final api = fake.api(tokens: tokens);
      await api.restoreSession();
      await expectLater(api.signOutEverywhere(), throwsA(isA<ApiProblem>()));
      expect(tokens.token, isNull);
      expect(fake.seen.single.headers['idempotency-key'], isNotEmpty);
    });
  });

  group('typed endpoints', () {
    test('market lots follow the cursor page', () async {
      final fake = FakeApi({
        'GET /v1/sell-lots': (r) => json({
              'items': [
                {
                  'sellLotId': 'lot_1',
                  'productId': 'prod_mature_coconut',
                  'unit': 'NUT',
                  'quantityTotal': '5000',
                  'quantityAvailable': '4000',
                  'fulfilment': {'mode': 'PICKUP', 'costsIncluded': ['LOADING'], 'costsExcluded': []},
                  'priceExpectation': {'inviteOffers': true},
                  'verificationClaims': [
                    {'type': 'MOBILE_CONTROL', 'displayLabelKey': 'claim.MOBILE_CONTROL'},
                  ],
                  'status': 'ACTIVE',
                },
              ],
              'page': {'nextCursor': r.url.queryParameters['cursor'] == null ? 'abc' : null, 'hasMore': true},
            }),
      });
      final api = fake.api();
      final first = await api.marketLots();
      expect(first.items.single.quantityAvailable, '4000');
      expect(first.items.single.invitesOffers, isTrue);
      expect(first.items.single.verificationClaims, ['MOBILE_CONTROL']);
      expect(first.hasMore, isTrue);
      final second = await api.marketLots(cursor: first.nextCursor);
      expect(second.hasMore, isFalse);
      expect(fake.seen.last.request.url.queryParameters['cursor'], 'abc');
    });

    test('recurring requirements post to the recurring endpoint with cadence', () async {
      final fake = FakeApi({'POST /v1/buy-requirements/recurring': (_) => json({}, status: 201)});
      await fake.api().createRequirement({'productId': 'p'}, cadence: 'WEEKLY', occurrences: 4);
      expect(fake.seen.single.body, {'productId': 'p', 'cadence': 'WEEKLY', 'occurrences': 4});
    });

    test('offers group into negotiation threads and deals derive milestones', () {
      final offers = [
        Offer.fromJson({'offerId': 'o2', 'threadId': 't1', 'revision': 2, 'createdAt': '2026-10-01T02:00:00Z', 'status': 'ACTIVE'}),
        Offer.fromJson({'offerId': 'o1', 'threadId': 't1', 'revision': 1, 'createdAt': '2026-10-01T01:00:00Z', 'status': 'COUNTERED'}),
        Offer.fromJson({'offerId': 'o3', 'threadId': 't2', 'revision': 1, 'createdAt': '2026-10-01T03:00:00Z', 'status': 'ACTIVE'}),
      ];
      final threads = NegotiationThread.group(offers);
      expect(threads.map((t) => t.threadId), ['t2', 't1']);
      expect(threads.last.offers.map((o) => o.offerId), ['o1', 'o2']);
      expect(threads.last.latest.offerId, 'o2');

      final deal = Deal.fromJson({
        'dealId': 'd',
        'status': 'DELIVERED',
        'cards': [
          {'revision': 1, 'terms': {'quantity': '100', 'unit': 'NUT', 'unitPricePaise': 3000}, 'totalPaise': 300000},
        ],
        'events': [
          {'seq': 1, 'type': 'DEAL_CREATED', 'actorId': 'b', 'at': '2026-10-01T01:00:00Z'},
          {'seq': 2, 'type': 'PICKUP_CONFIRMED', 'actorId': 'b', 'at': '2026-10-01T02:00:00Z'},
          {'seq': 3, 'type': 'DELIVERED', 'actorId': 's', 'at': '2026-10-01T03:00:00Z'},
        ],
        'pendingAmendment': {'terms': {'quantity': '90'}, 'proposedBy': 's'},
      });
      expect(deal.milestones.where((m) => m.done).map((m) => m.key), ['AGREED', 'PICKUP', 'DELIVERED']);
      expect(deal.card!.totalPaise, 300000);
      expect(deal.pendingAmendment!.quantity, '90');
      expect(deal.amendmentProposedBy, 's');
    });
  });

  test('newIdempotencyKey produces distinct v4 UUIDs', () {
    final a = newIdempotencyKey();
    final b = newIdempotencyKey();
    final uuid = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
    expect(uuid.hasMatch(a), isTrue, reason: a);
    expect(a, isNot(b));
  });
}

class _ThrowingClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) => Future.error(http.ClientException('Connection refused', request.url));
}
