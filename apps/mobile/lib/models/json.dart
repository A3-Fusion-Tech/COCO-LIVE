/// Small, lenient readers for API JSON. Unknown or missing fields fall back to safe defaults
/// so an additive server change never crashes the app.
typedef Json = Map<String, dynamic>;

Json asJson(Object? v) => v is Map<String, dynamic> ? v : (v is Map ? v.cast<String, dynamic>() : <String, dynamic>{});

String str(Object? v, [String fallback = '']) => v is String ? v : (v == null ? fallback : '$v');

String? strOrNull(Object? v) => v is String && v.isNotEmpty ? v : null;

int intOf(Object? v, [int fallback = 0]) => v is int ? v : (v is num ? v.round() : (int.tryParse('$v') ?? fallback));

int? intOrNull(Object? v) => v is int ? v : (v is num ? v.round() : null);

bool boolOf(Object? v) => v == true;

List<Json> listOfJson(Object? v) => v is List ? [for (final e in v) asJson(e)] : const [];

List<String> listOfStr(Object? v) => v is List ? [for (final e in v) '$e'] : const [];
