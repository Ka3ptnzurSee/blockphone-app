// VpnManager.m — registriert das Swift-Modul `VpnManager` in der RN-Bridge.
// Ohne diese Datei wäre NativeModules.VpnManager in JS `undefined`.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(VpnManager, NSObject)

RCT_EXTERN_METHOD(start:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(status:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setBlocklist:(NSArray *)domains
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
