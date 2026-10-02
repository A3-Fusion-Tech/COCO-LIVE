import 'package:flutter_test/flutter_test.dart';
import 'package:live_coco/l10n/strings.dart';
import 'package:live_coco/util/format.dart';

void main() {
  group('formatInr (paise → rupees)', () {
    test('whole rupees drop decimals, others keep two', () {
      expect(formatInr(3000, lang: 'en'), '₹30');
      expect(formatInr(3050, lang: 'en'), '₹30.50');
      expect(formatInr(5, lang: 'en'), '₹0.05');
      expect(formatInr(0, lang: 'en'), '₹0');
    });

    test('uses Indian digit grouping (lakh, crore)', () {
      expect(formatInr(1158200, lang: 'en'), '₹11,582');
      expect(formatInr(12345678900, lang: 'en'), '₹12,34,56,789');
      expect(formatInr(1234567850, lang: 'en'), '₹1,23,45,678.50');
    });

    test('Tamil formatting keeps ₹, Indian grouping and Western digits', () {
      expect(formatInr(1158200, lang: 'ta'), '₹11,582');
      expect(formatInr(3050, lang: 'ta'), '₹30.50');
    });
  });

  group('parseRupeesToPaise', () {
    test('accepts rupees with up to two decimals', () {
      expect(parseRupeesToPaise('30'), 3000);
      expect(parseRupeesToPaise('30.5'), 3050);
      expect(parseRupeesToPaise(' 30.05 '), 3005);
      expect(parseRupeesToPaise('11582'), 1158200);
    });

    test('rejects anything ambiguous', () {
      for (final bad in ['', '30.555', '-3', '3,000', 'abc', '30.']) {
        expect(parseRupeesToPaise(bad), isNull, reason: bad);
      }
    });

    test('round-trips through paiseToInput', () {
      for (final p in [0, 5, 3000, 3050, 1158200]) {
        expect(parseRupeesToPaise(paiseToInput(p)), p);
      }
    });
  });

  test('isValidQuantity accepts positive decimals with up to 3 places', () {
    expect(isValidQuantity('2500'), isTrue);
    expect(isValidQuantity('12.125'), isTrue);
    expect(isValidQuantity('0'), isFalse);
    expect(isValidQuantity('1.2345'), isFalse);
    expect(isValidQuantity('-1'), isFalse);
  });

  test('formatDateTime renders India Standard Time', () {
    expect(formatDateTime('2026-10-01T03:45:00Z'), '01-10-2026 09:15 IST');
    expect(formatDateTime('2026-10-01T09:15:00+05:30'), '01-10-2026 09:15 IST');
    expect(formatDateTime('2026-09-30T20:00:00Z'), '01-10-2026 01:30 IST');
    expect(formatDateTime(null), '—');
  });

  group('strings', () {
    test('Tamil and English catalogs have the same keys', () {
      final c = catalogForTesting;
      expect(c['ta']!.keys.toSet().difference(c['en']!.keys.toSet()), isEmpty);
      expect(c['en']!.keys.toSet().difference(c['ta']!.keys.toSet()), isEmpty);
    });

    test('lookup falls back to the code for unknown statuses', () {
      const s = S('ta');
      expect(s.status('ACTIVE'), 'செயலில்');
      expect(s.status('SOMETHING_NEW'), 'SOMETHING_NEW');
      expect(const S('en').code('fresh', 'STALE'), 'Stale — may be out of date');
    });
  });
}
