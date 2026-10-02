import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:live_coco/api/api_client.dart';
import 'package:live_coco/api/token_store.dart';

/// A recorded request.
class Seen {
  Seen(this.request) : body = request.body.isEmpty ? null : jsonDecode(request.body);
  final http.Request request;
  final Object? body;
  String get method => request.method;
  String get path => request.url.path;
  Map<String, String> get headers => request.headers;
}

typedef Responder = http.Response Function(http.Request request);

/// A fake API: routes "METHOD /path" to a responder and records every request.
class FakeApi {
  FakeApi(this.routes);

  final Map<String, Responder> routes;
  final List<Seen> seen = [];

  late final MockClient client = MockClient((request) async {
    seen.add(Seen(request));
    final route = routes['${request.method} ${request.url.path}'];
    if (route == null) return problem(404, 'NOT_FOUND', 'No such endpoint');
    return route(request);
  });

  ApiClient api({TokenStore? tokens}) => ApiClient(baseUrl: 'http://api.test', tokens: tokens ?? MemoryTokenStore(), httpClient: client);

  Iterable<Seen> to(String method, String path) => seen.where((s) => s.method == method && s.path == path);
}

http.Response json(Object body, {int status = 200}) =>
    http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});

http.Response problem(int status, String code, String message, {List<Map<String, String>> fieldErrors = const []}) => json({
      'type': 'https://docs.livecoco.example/problems/${code.toLowerCase()}',
      'title': code,
      'status': status,
      'code': code,
      'messageKey': 'error.${code.toLowerCase()}',
      'detail': 'detail',
      'correlationId': 'req_test',
      'fieldErrors': fieldErrors,
      'message': message,
    }, status: status);

const catalogJson = {
  'products': [
    {
      'productId': 'prod_mature_coconut',
      'name': {'en': 'Mature coconut', 'ta': 'முற்றிய தேங்காய்'},
      'units': ['NUT', 'KG'],
      'stages': ['FARM_GATE'],
      'requiredAttributes': ['husk'],
      'enabled': true,
    },
  ],
  'markets': [
    {
      'marketId': 'market_pollachi',
      'name': {'en': 'Pollachi', 'ta': 'பொள்ளாச்சி'},
      'areaId': 'area_pollachi_belt',
    },
  ],
};

const latestJson = {
  'items': [
    {
      'priceAggregateId': 'pa_1',
      'kind': 'AGGREGATE',
      'product': {'productId': 'prod_mature_coconut', 'name': 'Mature coconut', 'nameTa': 'முற்றிய தேங்காய்'},
      'market': {'marketId': 'market_pollachi', 'name': 'Pollachi', 'nameTa': 'பொள்ளாச்சி'},
      'stage': 'FARM_GATE',
      'tradeTerm': 'EX_FARM',
      'gradeGroup': 'FAQ',
      'range': {
        'low': {'amountPaise': 2900, 'currency': 'INR'},
        'reference': {'amountPaise': 3050, 'currency': 'INR'},
        'high': {'amountPaise': 3200, 'currency': 'INR'},
        'perUnit': 'NUT',
      },
      'observedWindow': {'startsAt': '2026-10-01T01:00:00Z', 'endsAt': '2026-10-01T03:45:00Z'},
      'freshness': 'CURRENT',
      'confidence': 'MEDIUM',
      'messageKey': null,
      'evidenceSummary': {'observations': 8, 'independentOrganizations': 5, 'officialMarketObservations': 1, 'verifiedQuotes': 6, 'completedTrades': 1},
      'calculationVersion': 'weighted-median-v1',
      'disclaimerKey': 'price.not_offer',
    },
    {
      'priceAggregateId': null,
      'kind': 'OFFICIAL_OBSERVATION_ONLY',
      'product': {'productId': 'prod_milling_copra', 'name': 'Milling copra', 'nameTa': 'கொப்பரை (ஆலை)'},
      'market': {'marketId': 'market_pollachi', 'name': 'Pollachi', 'nameTa': 'பொள்ளாச்சி'},
      'stage': 'REGULATED_MARKET',
      'tradeTerm': 'AT_MARKET',
      'gradeGroup': 'FAQ',
      'range': {
        'low': {'amountPaise': 1100000, 'currency': 'INR'},
        'reference': {'amountPaise': 1150050, 'currency': 'INR'},
        'high': {'amountPaise': 1200000, 'currency': 'INR'},
        'perUnit': 'QUINTAL',
      },
      'observedWindow': {'startsAt': '2026-09-20T05:00:00Z', 'endsAt': '2026-09-20T05:00:00Z'},
      'freshness': 'STALE',
      'confidence': 'LOW',
      'messageKey': 'price.insufficient',
      'evidenceSummary': {'observations': 1, 'independentOrganizations': 1, 'officialMarketObservations': 1, 'verifiedQuotes': 0, 'completedTrades': 0},
      'calculationVersion': null,
    },
  ],
  'disclaimerKey': 'price.not_offer',
};

const mspJson = {
  'items': [
    {'productId': 'prod_milling_copra', 'unit': 'QUINTAL', 'amountPaise': 1158200, 'seasonLabel': '2025 season (policy reference)', 'isMarketQuote': false, 'noteKey': 'price.msp_note'},
  ],
};

/// Routes the public board needs.
Map<String, Responder> publicRoutes() => {
      'GET /v1/catalog': (_) => json(catalogJson),
      'GET /v1/prices/latest': (_) => json(latestJson),
      'GET /v1/prices/msp': (_) => json(mspJson),
    };
