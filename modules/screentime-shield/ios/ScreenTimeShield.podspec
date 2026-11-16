Pod::Spec.new do |s|
  s.name           = 'ScreenTimeShield'
  s.version        = '1.0.0'
  s.summary        = 'Blockphone Screen-Time-Sperre (FamilyControls/ManagedSettings)'
  s.description    = 'Sperrt Apps kategorien- und einzeln ueber Apples Screen-Time-APIs.'
  s.author         = 'Blockphone'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.frameworks = 'FamilyControls', 'ManagedSettings', 'DeviceActivity'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
