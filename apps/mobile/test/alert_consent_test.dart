import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_coco/api/token_store.dart';
import 'package:live_coco/app.dart';
import 'package:live_coco/models/price.dart';
import 'package:live_coco/screens/alerts_screen.dart';
import 'package:live_coco/state/app_state.dart';

import 'support.dart';

void main() {
  testWidgets('an alert cannot be saved until consent is ticked, then posts consent=true', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    final fake = FakeApi({
      ...publicRoutes(),
      'GET /v1/me': (_) => json({'userId': 'user_1', 'locale': 'en', 'claims': []}),
      'POST /v1/alerts': (_) => json({'alertId': 'alert_1', 'status': 'ACTIVE'}, status: 201),
    });
    final state = AppState(fake.api(tokens: MemoryTokenStore('t')));
    await state.start();
    final price = PricePoint.fromJson((latestJson['items']! as List).first as Map<String, dynamic>);
    await tester.pumpWidget(AppScope(
      state: state,
      child: MaterialApp(theme: buildTheme(Brightness.light), home: Builder(builder: (_) => CreateAlertScreen(price: price))),
    ));
    await tester.pumpAndSettle();

    final save = find.widgetWithText(FilledButton, 'Save');
    expect(tester.widget<FilledButton>(save).onPressed, isNull);
    expect(find.text('Tick the consent box to save the alert.'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), '31.50');
    await tester.tap(find.byKey(const Key('alert-consent')));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(save).onPressed, isNotNull);
    expect(tester.getSize(save).height, greaterThanOrEqualTo(48));

    await tester.tap(save);
    await tester.pumpAndSettle();
    final sent = fake.to('POST', '/v1/alerts').single;
    expect(sent.body, {
      'productId': 'prod_mature_coconut',
      'marketId': 'market_pollachi',
      'unit': 'NUT',
      'stage': 'FARM_GATE',
      'direction': 'ABOVE',
      'channel': 'SMS',
      'consent': true,
      'thresholdPaise': 3150,
    });
    expect(sent.headers['idempotency-key'], isNotEmpty);
    expect(sent.headers['authorization'], 'Bearer t');
  });
}
