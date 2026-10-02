import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../models/catalog.dart';
import '../models/json.dart';
import '../models/marketplace.dart';
import '../models/price.dart';
import 'problem.dart';
import 'token_store.dart';

/// A random version-4 UUID used as an `Idempotency-Key` (docs/api/conventions.md §6).
String newIdempotencyKey([Random? random]) {
  final r = random ?? Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
}

/// A page of a cursor-paginated list (conventions §8).
class Page<T> {
  const Page(this.items, this.nextCursor);

  final List<T> items;
  final String? nextCursor;

  bool get hasMore => nextCursor != null;
}

/// Result of a successful OTP verification.
class SignedIn {
  const SignedIn(this.token, this.userId, this.locale);

  final String token;
  final String userId;
  final String locale;
}

/// Client for the `/v1` API. Only uses the existing contracts in docs/api/endpoints.md.
///
/// Every request sends `Accept-Language` and `?lang=`; every mutation sends an `Idempotency-Key`;
/// signed-in requests send `Authorization: Bearer <token>` with the token held in [TokenStore].
/// Failures throw [ApiProblem].
class ApiClient {
  ApiClient({
    required String baseUrl,
    required this.tokens,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 20),
  })  : baseUrl = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl,
        _http = httpClient ?? http.Client();

  final String baseUrl;
  final TokenStore tokens;
  final Duration timeout;
  final http.Client _http;

  /// UI language for server-localised messages ("ta" or "en").
  String language = 'ta';

  /// Called when the server rejects the stored token (401 on an authenticated request).
  void Function()? onSessionExpired;

  String? _token;

  bool get isSignedIn => _token != null;

  /// Loads the stored token, if any. Call once at start-up.
  Future<void> restoreSession() async => _token = await tokens.read();

  // ---- transport --------------------------------------------------------------------------

  Uri _uri(String path, [Map<String, String>? query]) {
    final base = Uri.parse('$baseUrl$path');
    return base.replace(queryParameters: {...base.queryParameters, ...?query, 'lang': language});
  }

  /// Sends one request and decodes the JSON body. Mutations (anything but GET) always carry an
  /// `Idempotency-Key`; pass [idempotencyKey] to reuse one across retries of the same action.
  Future<dynamic> send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
    String? idempotencyKey,
    int? ifMatch,
  }) async {
    final request = http.Request(method, _uri(path, query));
    request.headers['accept'] = 'application/json';
    request.headers['accept-language'] = language;
    final token = _token;
    if (token != null) request.headers['authorization'] = 'Bearer $token';
    if (method != 'GET') request.headers['idempotency-key'] = idempotencyKey ?? newIdempotencyKey();
    if (ifMatch != null) request.headers['if-match'] = '"$ifMatch"';
    if (body != null || method != 'GET') {
      request.headers['content-type'] = 'application/json';
      request.body = jsonEncode(body ?? const <String, dynamic>{});
    }

    final http.Response response;
    try {
      response = await http.Response.fromStream(await _http.send(request).timeout(timeout));
    } on TimeoutException {
      throw const ApiProblem.offline();
    } on http.ClientException {
      // package:http wraps socket, DNS and TLS failures in ClientException.
      throw const ApiProblem.offline();
    }

    final text = utf8.decode(response.bodyBytes, allowMalformed: true);
    Object? decoded;
    if (text.isNotEmpty) {
      try {
        decoded = jsonDecode(text);
      } on FormatException {
        decoded = null;
      }
    }
    if (response.statusCode >= 200 && response.statusCode < 300) return decoded;

    final problem = ApiProblem.fromJson(response.statusCode, decoded);
    if (problem.isUnauthenticated && token != null) {
      await _forget();
      onSessionExpired?.call();
    }
    throw problem;
  }

  Future<Json> _json(String method, String path, {Map<String, String>? query, Object? body, String? idempotencyKey, int? ifMatch}) async =>
      asJson(await send(method, path, query: query, body: body, idempotencyKey: idempotencyKey, ifMatch: ifMatch));

  Future<List<Json>> _items(String path, {Map<String, String>? query}) async => listOfJson((await _json('GET', path, query: query))['items']);

  Future<void> _forget() async {
    _token = null;
    await tokens.clear();
  }

  // ---- public price board -----------------------------------------------------------------

  Future<Catalog> catalog() async => Catalog.fromJson(await _json('GET', '/v1/catalog'));

  Future<PriceBoard> latestPrices({String? productId, String? marketId, String? stage, String? unit}) async {
    final query = {
      'productId': ?productId,
      'marketId': ?marketId,
      'stage': ?stage,
      'unit': ?unit,
    };
    return PriceBoard.fromJson(await _json('GET', '/v1/prices/latest', query: query));
  }

  Future<PriceEvidence> priceEvidence({required String productId, required String marketId, required String unit, required String stage}) async =>
      PriceEvidence.fromJson(await _json('GET', '/v1/prices/evidence', query: {'productId': productId, 'marketId': marketId, 'unit': unit, 'stage': stage}));

  Future<List<MspReference>> msp() async => [for (final j in await _items('/v1/prices/msp')) MspReference.fromJson(j)];

  // ---- identity ---------------------------------------------------------------------------

  Future<void> requestOtp(String phone, {String? idempotencyKey}) =>
      send('POST', '/v1/auth/otp/request', body: {'phone': phone}, idempotencyKey: idempotencyKey);

  /// Verifies the code and stores the bearer token in the keystore.
  Future<SignedIn> verifyOtp(String phone, String code, {String? idempotencyKey}) async {
    final j = await _json('POST', '/v1/auth/otp/verify', body: {'phone': phone, 'code': code}, idempotencyKey: idempotencyKey);
    final token = str(j['token']);
    if (token.isEmpty) throw const ApiProblem(status: 502, code: 'NO_TOKEN');
    _token = token;
    await tokens.write(token);
    final user = asJson(j['user']);
    return SignedIn(token, str(user['userId']), str(user['locale'], 'ta'));
  }

  Future<Me> me() async => Me.fromJson(await _json('GET', '/v1/me'));

  Future<void> updateLocale(String locale) => send('PATCH', '/v1/me', body: {'locale': locale});

  /// Signs out on this device: the token is removed from the keystore. The API has no
  /// single-session revoke endpoint, so the server session simply stops being used.
  Future<void> signOut() => _forget();

  /// Revokes every session of this user on the server (`/v1/me/sessions/revoke-all`), then
  /// forgets the local token.
  Future<void> signOutEverywhere() async {
    try {
      await send('POST', '/v1/me/sessions/revoke-all');
    } finally {
      await _forget();
    }
  }

  // ---- alerts -----------------------------------------------------------------------------

  Future<List<PriceAlert>> alerts() async => [for (final j in await _items('/v1/alerts')) PriceAlert.fromJson(j)];

  Future<PriceAlert> createAlert({
    required String productId,
    required String marketId,
    required String unit,
    required String stage,
    required String direction,
    required String channel,
    required bool consent,
    int? thresholdPaise,
    String? idempotencyKey,
  }) async =>
      PriceAlert.fromJson(await _json('POST', '/v1/alerts', idempotencyKey: idempotencyKey, body: {
        'productId': productId,
        'marketId': marketId,
        'unit': unit,
        'stage': stage,
        'direction': direction,
        'channel': channel,
        'consent': consent,
        'thresholdPaise': ?thresholdPaise,
      }));

  Future<PriceAlert> setAlertStatus(String alertId, String status) async =>
      PriceAlert.fromJson(await _json('PATCH', '/v1/alerts/${Uri.encodeComponent(alertId)}', body: {'status': status}));

  // ---- sell lots --------------------------------------------------------------------------

  Future<Page<SellLot>> marketLots({String? cursor, String? productId, int limit = 20}) async {
    final j = await _json('GET', '/v1/sell-lots', query: {
      'limit': '$limit',
      'cursor': ?cursor,
      'productId': ?productId,
    });
    return Page([for (final l in listOfJson(j['items'])) SellLot.fromJson(l)], strOrNull(asJson(j['page'])['nextCursor']));
  }

  Future<List<SellLot>> myLots() async => [for (final j in await _items('/v1/me/sell-lots')) SellLot.fromJson(j)];

  Future<SellLot> createLot(Json body, {String? idempotencyKey}) async =>
      SellLot.fromJson(await _json('POST', '/v1/sell-lots', body: body, idempotencyKey: idempotencyKey));

  Future<SellLot> activateLot(String id) async => SellLot.fromJson(await _json('POST', '/v1/sell-lots/${Uri.encodeComponent(id)}/activate'));

  Future<SellLot> withdrawLot(String id) async => SellLot.fromJson(await _json('POST', '/v1/sell-lots/${Uri.encodeComponent(id)}/withdraw'));

  /// Uploads a lot photo: upload intent, then a direct signed PUT (conventions §11).
  Future<void> uploadLotPhoto(String sellLotId, Uint8List bytes, String contentType) async {
    final intent = await _json('POST', '/v1/uploads/intents', body: {'purpose': 'LOT_PHOTO', 'contentType': contentType, 'sizeBytes': bytes.length, 'refId': sellLotId});
    final target = Uri.parse(str(intent['uploadUrl']));
    final base = Uri.parse(baseUrl);
    // The signed URL may be absolute (configured public base) or relative; send it to our API host.
    final url = base.replace(path: target.path, query: target.query);
    final http.Response response;
    try {
      response = await _http.put(url, headers: {'content-type': contentType}, body: bytes).timeout(timeout);
    } on TimeoutException {
      throw const ApiProblem.offline();
    } on http.ClientException {
      throw const ApiProblem.offline();
    }
    if (response.statusCode >= 300) {
      Object? decoded;
      try {
        decoded = jsonDecode(utf8.decode(response.bodyBytes));
      } on FormatException {
        decoded = null;
      }
      throw ApiProblem.fromJson(response.statusCode, decoded);
    }
  }

  // ---- buy requirements -------------------------------------------------------------------

  Future<List<BuyRequirement>> myRequirements() async => [for (final j in await _items('/v1/me/buy-requirements')) BuyRequirement.fromJson(j)];

  Future<void> createRequirement(Json body, {String? cadence, int? occurrences, String? idempotencyKey}) async {
    if (cadence == null) {
      await send('POST', '/v1/buy-requirements', body: body, idempotencyKey: idempotencyKey);
    } else {
      await send('POST', '/v1/buy-requirements/recurring', body: {...body, 'cadence': cadence, 'occurrences': occurrences ?? 4}, idempotencyKey: idempotencyKey);
    }
  }

  Future<List<MatchCandidate>> requirementMatches(String id) async =>
      [for (final j in await _items('/v1/buy-requirements/${Uri.encodeComponent(id)}/matches')) MatchCandidate.fromJson(j)];

  Future<void> closeRequirement(String id) => send('POST', '/v1/buy-requirements/${Uri.encodeComponent(id)}/close');

  // ---- offers and negotiation -------------------------------------------------------------

  Future<List<Offer>> offers() async => [for (final j in await _items('/v1/offers')) Offer.fromJson(j)];

  Future<Offer> createOffer({required String sellLotId, required OfferTerms terms, required DateTime expiresAt, String? idempotencyKey}) async =>
      Offer.fromJson(await _json('POST', '/v1/offers',
          idempotencyKey: idempotencyKey, body: {'sellLotId': sellLotId, 'terms': terms.raw, 'expiresAt': expiresAt.toUtc().toIso8601String()}));

  Future<Offer> counterOffer(Offer offer, OfferTerms terms, DateTime expiresAt, {String? idempotencyKey}) async =>
      Offer.fromJson(await _json('POST', '/v1/offers/${Uri.encodeComponent(offer.offerId)}/counter',
          ifMatch: offer.version, idempotencyKey: idempotencyKey, body: {'terms': terms.raw, 'expiresAt': expiresAt.toUtc().toIso8601String()}));

  /// Accepting creates a deal. The key is derived from the offer so a retried tap can never
  /// accept twice.
  Future<Deal> acceptOffer(Offer offer) async =>
      Deal.fromJson(await _json('POST', '/v1/offers/${Uri.encodeComponent(offer.offerId)}/accept', ifMatch: offer.version, idempotencyKey: 'accept-${offer.offerId}'));

  Future<void> rejectOffer(String offerId) => send('POST', '/v1/offers/${Uri.encodeComponent(offerId)}/reject');

  Future<void> withdrawOffer(String offerId) => send('POST', '/v1/offers/${Uri.encodeComponent(offerId)}/withdraw');

  // ---- deals ------------------------------------------------------------------------------

  Future<List<Deal>> deals() async => [for (final j in await _items('/v1/deals')) Deal.fromJson(j)];

  Future<Deal> deal(String id) async => Deal.fromJson(await _json('GET', '/v1/deals/${Uri.encodeComponent(id)}'));

  /// A deal milestone or decision: pickup, delivery, accept, payment, complete, cancel, amendments/respond.
  Future<void> dealAction(String dealId, String action, {Json body = const {}, String? idempotencyKey}) =>
      send('POST', '/v1/deals/${Uri.encodeComponent(dealId)}/$action', body: body, idempotencyKey: idempotencyKey);
}
