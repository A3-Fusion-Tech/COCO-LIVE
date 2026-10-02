import 'json.dart';

class LocalName {
  const LocalName(this.en, this.ta);

  factory LocalName.fromJson(Object? v) {
    final j = asJson(v);
    return LocalName(str(j['en']), str(j['ta'], str(j['en'])));
  }

  final String en;
  final String ta;

  String of(String lang) => lang == 'ta' && ta.isNotEmpty ? ta : en;
}

class Product {
  const Product({required this.productId, required this.name, required this.units, required this.requiredAttributes});

  factory Product.fromJson(Json j) => Product(
        productId: str(j['productId']),
        name: LocalName.fromJson(j['name']),
        units: listOfStr(j['units']),
        requiredAttributes: listOfStr(j['requiredAttributes']),
      );

  final String productId;
  final LocalName name;
  final List<String> units;
  final List<String> requiredAttributes;
}

class Market {
  const Market({required this.marketId, required this.name});

  factory Market.fromJson(Json j) => Market(marketId: str(j['marketId']), name: LocalName.fromJson(j['name']));

  final String marketId;
  final LocalName name;
}

/// `GET /v1/catalog`: enabled products and Pollachi-belt markets.
class Catalog {
  const Catalog({required this.products, required this.markets});

  factory Catalog.fromJson(Json j) => Catalog(
        products: [for (final p in listOfJson(j['products'])) Product.fromJson(p)],
        markets: [for (final m in listOfJson(j['markets'])) Market.fromJson(m)],
      );

  static const empty = Catalog(products: [], markets: []);

  final List<Product> products;
  final List<Market> markets;

  Product? product(String id) => products.where((p) => p.productId == id).firstOrNull;

  String productName(String id, String lang) => product(id)?.name.of(lang) ?? id;

  String marketName(String id, String lang) =>
      markets.where((m) => m.marketId == id).firstOrNull?.name.of(lang) ?? id;
}
