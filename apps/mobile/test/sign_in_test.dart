import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_coco/api/token_store.dart';
import 'package:live_coco/app.dart';
import 'package:live_coco/state/app_state.dart';

import 'support.dart';

void main() {
  late MemoryTokenStore tokens;

  Future<(FakeApi, AppState)> pump(WidgetTester tester, Map<String, Responder> extra) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    tokens = MemoryTokenStore();
    final fake = FakeApi({...publicRoutes(), ...extra});
    final state = AppState(fake.api(tokens: tokens));
    await state.start();
    await tester.pumpWidget(LiveCocoApp(state: state));
    await tester.pumpAndSettle();
    // Open the sign-in tab.
    await tester.tap(find.text('உள்நுழை').last);
    await tester.pumpAndSettle();
    return (fake, state);
  }

  testWidgets('phone OTP sign-in stores the token and unlocks the marketplace tabs', (tester) async {
    final (fake, state) = await pump(tester, {
      'POST /v1/auth/otp/request': (_) => json({'sent': true}),
      'POST /v1/auth/otp/verify': (_) => json({
            'token': 'tok_123',
            'user': {'userId': 'user_1', 'capabilities': [], 'locale': 'ta'},
          }),
      'GET /v1/me': (_) => json({'userId': 'user_1', 'displayName': 'வள்ளி', 'locale': 'ta', 'capabilities': [], 'claims': []}),
    });

    expect(find.text('கைபேசி எண்ணுடன் உள்நுழையவும்'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('phone')), '+91 90000 00001');
    await tester.tap(find.byKey(const Key('send-code')));
    await tester.pumpAndSettle();

    final otpRequest = fake.to('POST', '/v1/auth/otp/request').single;
    expect(otpRequest.body, {'phone': '+91 90000 00001'});
    expect(otpRequest.headers['idempotency-key'], isNotEmpty);
    expect(find.text('குறியீடு அனுப்பப்பட்டது. 5 நிமிடங்களில் காலாவதியாகும்.'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('code')), '123456');
    await tester.tap(find.byKey(const Key('verify')));
    await tester.pumpAndSettle();

    expect(fake.to('POST', '/v1/auth/otp/verify').single.body, {'phone': '+91 90000 00001', 'code': '123456'});
    expect(tokens.token, 'tok_123');
    expect(state.signedIn, isTrue);
    expect(fake.to('GET', '/v1/me').last.headers['authorization'], 'Bearer tok_123');
    // Signed-in navigation and account view.
    expect(find.text('ஒப்பந்தங்கள்'), findsWidgets);
    expect(find.text('வள்ளி'), findsOneWidget);

    // Logout clears the keystore and returns to the sign-in form.
    await tester.tap(find.text('வெளியேறு'));
    await tester.pumpAndSettle();
    expect(tokens.token, isNull);
    expect(state.signedIn, isFalse);
    expect(find.text('கைபேசி எண்ணுடன் உள்நுழையவும்'), findsOneWidget);
  });

  testWidgets('a wrong code shows the server problem message and stores nothing', (tester) async {
    await pump(tester, {
      'POST /v1/auth/otp/request': (_) => json({'sent': true}),
      'POST /v1/auth/otp/verify': (_) => problem(401, 'OTP_INVALID', 'குறியீடு தவறானது அல்லது காலாவதியானது'),
    });
    await tester.enterText(find.byKey(const Key('phone')), '9000000001');
    await tester.tap(find.byKey(const Key('send-code')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('code')), '000000');
    await tester.tap(find.byKey(const Key('verify')));
    await tester.pumpAndSettle();

    expect(find.text('குறியீடு தவறானது அல்லது காலாவதியானது'), findsOneWidget);
    expect(tokens.token, isNull);
  });

  testWidgets('a short phone number is rejected before any request', (tester) async {
    final (fake, _) = await pump(tester, {});
    await tester.enterText(find.byKey(const Key('phone')), '12345');
    await tester.tap(find.byKey(const Key('send-code')));
    await tester.pumpAndSettle();
    expect(find.text('தேவை'), findsOneWidget);
    expect(fake.to('POST', '/v1/auth/otp/request'), isEmpty);
  });
}
