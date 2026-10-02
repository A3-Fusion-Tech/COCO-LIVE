// Opt-in contract check against a running development API (in-memory or PostgreSQL).
// Skipped unless LIVE_API_URL is set. The API must print dev OTPs (`[dev-otp] <phone>: <code>`)
// to the log file named by LIVE_API_LOG, and +919000000001 must be an operator:
//
//   OPERATOR_PHONES=+919000000001 PORT=4011 npm run dev > /tmp/api.log 2>&1 &
//   LIVE_API_URL=http://localhost:4011 LIVE_API_LOG=/tmp/api.log flutter test test/live_api_test.dart
//
// Use a freshly started in-memory API (no DATABASE_URL): the test creates fixed synthetic users.
// It drives the app's ApiClient through the mobile flows: board, sign-in, alerts, sell lot,
// requirement, offer → counter → accept, and every deal milestone.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:live_coco/api/api_client.dart';
import 'package:live_coco/api/problem.dart';
import 'package:live_coco/api/token_store.dart';
import 'package:live_coco/models/marketplace.dart';

final _base = Platform.environment['LIVE_API_URL'];
final _log = Platform.environment['LIVE_API_LOG'];

Future<String> _otpFor(String phone) async {
  for (var i = 0; i < 20; i++) {
    final lines = File(_log!).readAsLinesSync().where((l) => l.contains('[dev-otp] $phone:'));
    if (lines.isNotEmpty) return lines.last.split(': ').last.trim();
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
  throw StateError('no OTP for $phone in $_log');
}

Future<ApiClient> _signIn(String phone, {String lang = 'en'}) async {
  final api = ApiClient(baseUrl: _base!, tokens: MemoryTokenStore())..language = lang;
  await api.requestOtp(phone);
  await api.verifyOtp(phone, await _otpFor(phone));
  return api;
}

/// Raw operator call with step-up (operator screens are web-only).
class _Operator {
  _Operator(this.token);
  final String token;

  static Future<_Operator> start() async {
    const phone = '+919000000001';
    final op = _Operator(await _tokenOf(await _signIn(phone)));
    await op.post('/v1/auth/step-up/request', {});
    await op.post('/v1/auth/step-up', {'code': await _otpFor(phone)});
    return op;
  }

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    final r = await http.post(Uri.parse('$_base$path'),
        headers: {'authorization': 'Bearer $token', 'content-type': 'application/json', 'idempotency-key': newIdempotencyKey()}, body: jsonEncode(body));
    if (r.statusCode >= 300) throw StateError('$path ${r.statusCode} ${r.body}');
    return jsonDecode(r.body) as Map<String, dynamic>;
  }
}

void main() {
  final skip = _base == null || _log == null ? 'set LIVE_API_URL and LIVE_API_LOG to run' : null;

  test('mobile flows against a running API', () async {
    final public = ApiClient(baseUrl: _base!, tokens: MemoryTokenStore())..language = 'ta';
    final catalog = await public.catalog();
    expect(catalog.products, isNotEmpty);
    await public.latestPrices();
    final msp = await public.msp();
    expect(msp.first.amountPaise, greaterThan(0));

    final seller = await _signIn('+919000000102', lang: 'ta');
    final buyer = await _signIn('+919000000103');
    final op = await _Operator.start();
    final sellerMe = await seller.me();
    final buyerMe = await buyer.me();

    // Alerts: consent is required, then pause / cancel.
    await expectLater(
      seller.createAlert(productId: 'prod_mature_coconut', marketId: 'market_pollachi', unit: 'NUT', stage: 'FARM_GATE', direction: 'ABOVE', channel: 'SMS', consent: false, thresholdPaise: 3000),
      throwsA(isA<ApiProblem>().having((p) => p.message, 'message', isNotEmpty)),
    );
    final alert = await seller.createAlert(productId: 'prod_mature_coconut', marketId: 'market_pollachi', unit: 'NUT', stage: 'FARM_GATE', direction: 'ABOVE', channel: 'SMS', consent: true, thresholdPaise: 3000);
    expect((await seller.setAlertStatus(alert.alertId, 'PAUSED')).status, 'PAUSED');
    expect((await seller.alerts()).single.alertId, alert.alertId);

    // Sell lot: draft → (operator photo exception) → review → active.
    final now = DateTime.now().toUtc();
    final lot = await seller.createLot({
      'productId': 'prod_mature_coconut',
      'gradeAttributes': {'husk': 'WITH_HUSK'},
      'gradeGroup': 'FAQ',
      'unit': 'NUT',
      'quantityTotal': '5000',
      'partialFulfilmentAllowed': true,
      'originMarketId': 'market_pollachi',
      'availableFrom': now.add(const Duration(minutes: 1)).toIso8601String(),
      'availableTo': now.add(const Duration(days: 3)).toIso8601String(),
      'expiresAt': now.add(const Duration(days: 7)).toIso8601String(),
      'fulfilment': {'mode': 'PICKUP', 'costsIncluded': ['LOADING'], 'costsExcluded': ['TRANSPORT']},
      'priceExpectation': {'unitPricePaise': 3100},
    });
    expect(lot.status, 'DRAFT');
    await expectLater(seller.activateLot(lot.sellLotId), throwsA(isA<ApiProblem>().having((p) => p.status, 'status', 422)));
    await op.post('/v1/ops/listings/${lot.sellLotId}/photo-exception', {'reason': 'contract test'});
    final pending = await seller.activateLot(lot.sellLotId);
    if (pending.status == 'PENDING_REVIEW') {
      await op.post('/v1/ops/listings/${lot.sellLotId}/review', {'decision': 'APPROVE', 'reason': 'contract test'});
    }
    expect((await seller.myLots()).single.status, 'ACTIVE');

    final market = await buyer.marketLots();
    final listed = market.items.firstWhere((l) => l.sellLotId == lot.sellLotId);
    expect(listed.quantityAvailable, '5000');

    // Buyer requirement needs verification.
    await expectLater(
      buyer.createRequirement(_requirement(now)),
      throwsA(isA<ApiProblem>().having((p) => p.status, 'status', 403)),
    );
    final claim = await http.post(Uri.parse('$_base/v1/claims'),
        headers: {'authorization': 'Bearer ${await _tokenOf(buyer)}', 'content-type': 'application/json', 'idempotency-key': newIdempotencyKey()},
        body: jsonEncode({'type': 'PERSON_IDENTITY', 'scope': {}, 'evidence': ['test']}));
    final claimId = (jsonDecode(claim.body) as Map<String, dynamic>)['claimId'] as String;
    await op.post('/v1/ops/claims/$claimId/decision', {'decision': 'APPROVED', 'reasonCode': 'DOCS_OK'});
    await buyer.createRequirement(_requirement(now));
    final reqs = await buyer.myRequirements();
    expect(reqs.single.status, 'ACTIVE');
    await buyer.requirementMatches(reqs.single.requirementId);

    // Offer → counter → accept.
    final terms = offerTermsForLot(listed,
        quantity: '2000', unitPricePaise: 2950, paymentMethod: 'UPI', paymentDue: 'ON_DELIVERY', weighmentMethod: 'COUNT', weighmentLocation: 'Pollachi');
    final offer = await buyer.createOffer(sellLotId: listed.sellLotId, terms: terms, expiresAt: DateTime.now().add(const Duration(hours: 24)));
    expect(offer.estimatedTotalPaise, 2000 * 2950);
    final sellerView = (await seller.offers()).single;
    final counter = await seller.counterOffer(sellerView, sellerView.terms.copyWith(unitPricePaise: 3000), DateTime.now().add(const Duration(hours: 24)));
    expect(counter.revision, 2);
    final threads = NegotiationThread.group(await buyer.offers());
    expect(threads.single.offers.map((o) => o.status), ['COUNTERED', 'ACTIVE']);
    final deal = await buyer.acceptOffer(threads.single.latest);
    expect(deal.status, 'AGREED');
    expect(deal.card!.totalPaise, 2000 * 3000);

    // Milestones.
    await buyer.dealAction(deal.dealId, 'pickup');
    await seller.dealAction(deal.dealId, 'delivery', body: {'actualQuantity': '2000'});
    await buyer.dealAction(deal.dealId, 'accept');
    await seller.dealAction(deal.dealId, 'payment', body: {'method': 'UPI'});
    await seller.dealAction(deal.dealId, 'complete');
    final done = await buyer.deal(deal.dealId);
    expect(done.status, 'COMPLETED');
    expect(done.milestones.every((m) => m.done), isTrue, reason: done.events.map((e) => e.type).join(','));
    expect((await seller.deals()).single.sellerId, sellerMe.userId);
    expect(done.buyerId, buyerMe.userId);

    // Tamil problem messages come back localised.
    await expectLater(seller.deal('deal_missing'), throwsA(isA<ApiProblem>().having((p) => p.status, 'status', 404)));

    await seller.signOutEverywhere();
    await expectLater(seller.me(), throwsA(isA<ApiProblem>().having((p) => p.status, 'status', 401)));
  }, skip: skip, timeout: const Timeout(Duration(minutes: 2)));
}

Map<String, dynamic> _requirement(DateTime now) => {
      'productId': 'prod_mature_coconut',
      'gradeGroup': 'FAQ',
      'unit': 'NUT',
      'targetQuantity': '3000',
      'minQuantity': '1000',
      'partialAllowed': true,
      'destinationMarketId': 'market_pollachi',
      'maxRadiusKm': 40,
      'requiredFrom': now.add(const Duration(minutes: 1)).toIso8601String(),
      'requiredBy': now.add(const Duration(days: 5)).toIso8601String(),
      'expiresAt': now.add(const Duration(days: 4)).toIso8601String(),
    };

Future<String> _tokenOf(ApiClient api) async => (await api.tokens.read())!;
