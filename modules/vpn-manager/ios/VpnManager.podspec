Pod::Spec.new do |s|
  s.name           = 'VpnManager'
  s.version        = '1.0.0'
  s.summary        = 'Blockphone DNS-Tunnel-Steuerung'
  s.description    = 'NETunnelProviderManager-Bridge fuer den Blockphone DNS-Blocker.'
  s.author         = 'Blockphone'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
