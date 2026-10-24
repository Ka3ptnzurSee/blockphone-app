// ScreenTime.m — registriert das Swift-Modul `ScreenTime` in der RN-Bridge.
// Ohne diese Datei wäre NativeModules.ScreenTime in JS `undefined`.
// (Legacy-Bridge: Swift-Klasse mit @objc(ScreenTime) + hier RCT_EXTERN_MODULE/METHOD.)

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ScreenTime, NSObject)

RCT_EXTERN_METHOD(authorize:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(shieldAllSocial:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(unshield:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(status:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
