/// A failed API call, carrying the problem+json body described in docs/api/conventions.md §5.
///
/// The server localises `message` from `Accept-Language`/`?lang=`; clients show it and never
/// branch on translated text (use [code] for logic).
class ApiProblem implements Exception {
  const ApiProblem({
    required this.status,
    required this.code,
    this.message,
    this.title,
    this.detail,
    this.messageKey,
    this.correlationId,
    this.fieldErrors = const [],
  });

  /// No response reached the app (no network, DNS failure, timeout).
  const ApiProblem.offline() : this(status: 0, code: offlineCode);

  static const offlineCode = 'OFFLINE';

  factory ApiProblem.fromJson(int status, Object? json) {
    final body = json is Map<String, dynamic> ? json : const <String, dynamic>{};
    final errors = body['fieldErrors'];
    return ApiProblem(
      status: status,
      code: body['code'] is String ? body['code'] as String : 'HTTP_$status',
      message: _text(body['message']),
      title: _text(body['title']),
      detail: _text(body['detail']),
      messageKey: _text(body['messageKey']),
      correlationId: _text(body['correlationId']),
      fieldErrors: errors is List
          ? [
              for (final e in errors)
                if (e is Map && e['field'] is String) FieldError(e['field'] as String, '${e['code'] ?? ''}'),
            ]
          : const [],
    );
  }

  final int status;
  final String code;
  final String? message;
  final String? title;
  final String? detail;
  final String? messageKey;
  final String? correlationId;
  final List<FieldError> fieldErrors;

  bool get isOffline => code == offlineCode;
  bool get isUnauthenticated => status == 401;

  /// Text to show a person: the localised `message`, then the field names for validation
  /// failures; [fallback] when the server sent nothing usable.
  String displayMessage(String fallback) {
    final base = message ?? title ?? fallback;
    if (fieldErrors.isEmpty) return base;
    return '$base: ${fieldErrors.map((f) => f.field).join(', ')}';
  }

  @override
  String toString() => 'ApiProblem($status $code${message == null ? '' : ': $message'})';

  static String? _text(Object? v) => v is String && v.isNotEmpty ? v : null;
}

class FieldError {
  const FieldError(this.field, this.code);
  final String field;
  final String code;
}
