import 'package:intl/intl.dart';

/// Formats integer paise as Indian rupees (₹ with Indian digit grouping), following ADR-003:
/// money is always integer paise on the wire. Whole rupees drop the decimals.
String formatInr(int paise, {String lang = 'ta'}) {
  final whole = paise % 100 == 0;
  final format = NumberFormat.currency(
    locale: lang == 'ta' ? 'ta_IN' : 'en_IN',
    symbol: '₹',
    decimalDigits: whole ? 0 : 2,
  );
  return format.format(paise / 100);
}

final _amount = RegExp(r'^\s*(\d+)(?:\.(\d{1,2}))?\s*$');

/// Parses a rupee amount typed by a person ("30", "30.5", "30.50") into integer paise.
/// Returns null for anything else (negative, more than two decimals, letters, empty).
int? parseRupeesToPaise(String input) {
  final m = _amount.firstMatch(input);
  if (m == null) return null;
  final rupees = int.parse(m.group(1)!);
  final fraction = (m.group(2) ?? '').padRight(2, '0');
  return rupees * 100 + int.parse(fraction.isEmpty ? '0' : fraction);
}

/// The value to prefill an amount field with, e.g. 3050 paise → "30.50", 3000 → "30".
String paiseToInput(int paise) {
  final rupees = paise ~/ 100;
  final rest = paise % 100;
  return rest == 0 ? '$rupees' : '$rupees.${rest.toString().padLeft(2, '0')}';
}

final _quantity = RegExp(r'^\d+(\.\d{1,3})?$');

/// Quantities travel as decimal strings (ADR-003); this checks a positive decimal with up to 3 places.
bool isValidQuantity(String input) {
  final v = input.trim();
  return _quantity.hasMatch(v) && double.parse(v) > 0;
}

const _istOffset = Duration(hours: 5, minutes: 30);

/// Formats an RFC 3339 instant in India Standard Time as "02-10-2026 09:15 IST".
/// Numeric on purpose: identical and unambiguous in Tamil and English.
String formatDateTime(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  final parsed = DateTime.tryParse(iso);
  if (parsed == null) return iso;
  final ist = parsed.toUtc().add(_istOffset);
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(ist.day)}-${two(ist.month)}-${ist.year} ${two(ist.hour)}:${two(ist.minute)} IST';
}

/// Formats a date only (IST), e.g. "02-10-2026".
String formatDate(DateTime value) {
  final ist = value.toUtc().add(_istOffset);
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(ist.day)}-${two(ist.month)}-${ist.year}';
}

/// UTC RFC 3339 string for an instant, as the API expects.
String toIso(DateTime value) => value.toUtc().toIso8601String();
