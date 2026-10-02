import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_coco/app.dart';
import 'package:live_coco/state/app_state.dart';

import 'support.dart';

Future<(FakeApi, AppState)> pumpApp(WidgetTester tester, Map<String, Responder> routes) async {
  tester.view.physicalSize = const Size(1080, 3200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final fake = FakeApi(routes);
  final state = AppState(fake.api());
  await state.start();
  await tester.pumpWidget(LiveCocoApp(state: state));
  await tester.pumpAndSettle();
  return (fake, state);
}

void main() {
  testWidgets('public price board renders in Tamil without sign-in', (tester) async {
    final (fake, _) = await pumpApp(tester, {
      ...publicRoutes(),
      'GET /v1/prices/evidence': (_) => json({
            'calculationVersion': 'weighted-median-v1',
            'calculatedAt': '2026-10-01T04:00:00Z',
            'evidenceSummary': {'observations': 2, 'independentOrganizations': 2},
            'observations': [
              {
                'sourceClass': 'VERIFIED_QUOTE',
                'observedAt': '2026-10-01T02:00:00Z',
                'range': {
                  'low': {'amountPaise': 2900},
                  'reference': {'amountPaise': 3000},
                  'high': {'amountPaise': 3100},
                  'perUnit': 'NUT',
                },
              },
            ],
          }),
    });

    // Disclaimer, names, the three range values and freshness/confidence as words.
    expect(find.text('குறிப்பு விலைகள் உத்தரவாதமான சலுகைகள் அல்ல. வர்த்தக முடிவுக்கு முன் வாங்குபவருடன் உறுதிசெய்யவும்.'), findsOneWidget);
    expect(find.text('முற்றிய தேங்காய் · பொள்ளாச்சி'), findsOneWidget);
    expect(find.text('₹29'), findsOneWidget);
    expect(find.text('₹30.50'), findsOneWidget);
    expect(find.text('₹32'), findsOneWidget);
    expect(find.text('தற்போதையது'), findsOneWidget);
    expect(find.text('நடுத்தர நம்பகத்தன்மை'), findsOneWidget);
    expect(find.text('01-10-2026 09:15 IST'), findsOneWidget);
    // Official-only row: stale + low confidence + insufficient-evidence note, no evidence button.
    expect(find.text('பழையது — காலாவதியாக இருக்கலாம்'), findsOneWidget);
    expect(find.text('குறைந்த நம்பகத்தன்மை'), findsOneWidget);
    expect(find.textContaining('சமீபத்திய அதிகாரப்பூர்வ சந்தைப் பதிவு மட்டும்'), findsOneWidget);
    expect(find.text('ஆதாரம் காண்க'), findsOneWidget);
    // MSP is shown separately and labelled as a policy reference.
    expect(find.text('MSP ஒரு கொள்கை குறிப்பு; சந்தை விலை அல்ல.'), findsOneWidget);
    expect(find.textContaining('₹11,582 / குவிண்டால்'), findsOneWidget);
    // Signed-out navigation: no trade or deals tabs.
    expect(find.text('ஒப்பந்தங்கள்'), findsNothing);

    // Requests asked for Tamil.
    final latest = fake.to('GET', '/v1/prices/latest').single;
    expect(latest.request.url.queryParameters['lang'], 'ta');
    expect(latest.headers['accept-language'], 'ta');

    // Evidence view.
    await tester.tap(find.text('ஆதாரம் காண்க'));
    await tester.pumpAndSettle();
    expect(find.text('விலை ஆதாரம்'), findsOneWidget);
    expect(find.text('சரிபார்க்கப்பட்ட விலைப்புள்ளி'), findsOneWidget);
    expect(find.text('₹29 – ₹31'), findsOneWidget);
    final evidence = fake.to('GET', '/v1/prices/evidence').single.request.url.queryParameters;
    expect(evidence, containsPair('productId', 'prod_mature_coconut'));
    expect(evidence, containsPair('unit', 'NUT'));
    expect(evidence, containsPair('stage', 'FARM_GATE'));
  });

  testWidgets('language toggle switches to English and refetches with lang=en', (tester) async {
    final (fake, _) = await pumpApp(tester, publicRoutes());
    await tester.tap(find.byKey(const Key('language-toggle')));
    await tester.pumpAndSettle();

    expect(find.text('Reference prices are not guaranteed offers. Confirm with a buyer before making a trade decision.'), findsOneWidget);
    expect(find.text('Mature coconut · Pollachi'), findsOneWidget);
    expect(find.text('Medium confidence'), findsOneWidget);
    expect(find.text('Current'), findsOneWidget);
    expect(fake.to('GET', '/v1/prices/latest').last.request.url.queryParameters['lang'], 'en');
  });

  testWidgets('setting an alert while signed out asks for sign-in first', (tester) async {
    await pumpApp(tester, publicRoutes());
    await tester.tap(find.text('விலை எச்சரிக்கை அமை').first);
    await tester.pumpAndSettle();
    expect(find.text('கைபேசி எண்ணுடன் உள்நுழையவும்'), findsOneWidget);
  });

  testWidgets('a failed load shows the server message and retries', (tester) async {
    var calls = 0;
    await pumpApp(tester, {
      ...publicRoutes(),
      'GET /v1/prices/latest': (_) => ++calls == 1 ? problem(503, 'UNAVAILABLE', 'பின்னர் முயற்சிக்கவும்') : json(latestJson),
    });
    expect(find.text('பின்னர் முயற்சிக்கவும்'), findsOneWidget);
    await tester.tap(find.text('மீண்டும் முயற்சி'));
    await tester.pumpAndSettle();
    expect(find.text('முற்றிய தேங்காய் · பொள்ளாச்சி'), findsOneWidget);
  });
}
