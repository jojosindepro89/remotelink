/**
 * Expo config plugin: withRemoteControl
 *
 * Wires the native Android AccessibilityService + React Native bridge module
 * into the generated `android/` project during `expo prebuild`. Runs every
 * time we prebuild — no need to maintain native code by hand.
 *
 * Steps performed:
 *   1. Copy four source files into android/app/src/main/...:
 *        - RemoteControlService.kt
 *        - RemoteControlModule.kt
 *        - RemoteControlPackage.kt
 *        - accessibility_service_config.xml (res/xml/)
 *        - strings_remote_control.xml      (res/values/)
 *   2. Modify MainApplication.kt to register RemoteControlPackage().
 *   3. Modify AndroidManifest.xml to declare the AccessibilityService.
 */

const { withDangerousMod, withAndroidManifest, withMainApplication } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

const PKG = 'com.remotelink.mobile'
const PKG_PATH = PKG.split('.').join('/')

function copyKotlinSources(config) {
  return withDangerousMod(config, ['android', async (config) => {
    const projectRoot = config.modRequest.platformProjectRoot
    const javaDir = path.join(projectRoot, 'app/src/main/java', PKG_PATH)
    const resXmlDir = path.join(projectRoot, 'app/src/main/res/xml')
    const resValuesDir = path.join(projectRoot, 'app/src/main/res/values')
    const pluginDir = path.join(config.modRequest.projectRoot, 'plugins/android')

    fs.mkdirSync(javaDir, { recursive: true })
    fs.mkdirSync(resXmlDir, { recursive: true })
    fs.mkdirSync(resValuesDir, { recursive: true })

    fs.copyFileSync(
      path.join(pluginDir, 'RemoteControlService.kt'),
      path.join(javaDir, 'RemoteControlService.kt')
    )
    fs.copyFileSync(
      path.join(pluginDir, 'RemoteControlModule.kt'),
      path.join(javaDir, 'RemoteControlModule.kt')
    )
    fs.copyFileSync(
      path.join(pluginDir, 'RemoteControlPackage.kt'),
      path.join(javaDir, 'RemoteControlPackage.kt')
    )
    fs.copyFileSync(
      path.join(pluginDir, 'accessibility_service_config.xml'),
      path.join(resXmlDir, 'accessibility_service_config.xml')
    )
    fs.copyFileSync(
      path.join(pluginDir, 'strings_remote_control.xml'),
      path.join(resValuesDir, 'strings_remote_control.xml')
    )

    return config
  }])
}

function registerPackageInMainApplication(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents
    const importLine = `import com.remotelink.mobile.RemoteControlPackage`
    if (!contents.includes(importLine)) {
      // Insert the import after the package declaration
      contents = contents.replace(
        /(package com\.remotelink\.mobile\n)/,
        `$1\n${importLine}\n`
      )
    }
    // Inject RemoteControlPackage() into getPackages() list.
    // SDK 50 template uses: `return PackageList(this).packages`
    if (!contents.includes('RemoteControlPackage()')) {
      // Pattern A: direct return — SDK 50 default
      contents = contents.replace(
        /return\s+PackageList\(this\)\.packages\s*(\n|\r\n)/,
        `return PackageList(this).packages.apply {\n              add(RemoteControlPackage())\n            }$1`
      )
      // Pattern B: variable assignment (older template)
      if (!contents.includes('RemoteControlPackage()')) {
        contents = contents.replace(
          /(val\s+packages\s*=\s*PackageList\(this\)\.packages)\s*(\n|\r\n)/,
          `$1.apply {\n              add(RemoteControlPackage())\n            }$2`
        )
      }
      // Pattern C: existing .apply block — append into it
      if (!contents.includes('RemoteControlPackage()')) {
        contents = contents.replace(
          /(\.apply\s*\{\s*(\n|\r\n))/,
          `$1              add(RemoteControlPackage())\n`
        )
      }
    }
    config.modResults.contents = contents
    return config
  })
}

function declareServiceInManifest(config) {
  return withAndroidManifest(config, async (config) => {
    const app = config.modResults.manifest.application?.[0]
    if (!app) return config
    app.service = app.service || []
    const alreadyDeclared = app.service.some(
      (s) => s.$?.['android:name'] === '.RemoteControlService'
    )
    if (!alreadyDeclared) {
      app.service.push({
        $: {
          'android:name': '.RemoteControlService',
          'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
          'android:exported': 'true',
          'android:label': '@string/remote_control_service_summary',
        },
        'intent-filter': [{
          action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }],
        }],
        'meta-data': [{
          $: {
            'android:name': 'android.accessibilityservice',
            'android:resource': '@xml/accessibility_service_config',
          },
        }],
      })
    }
    return config
  })
}

module.exports = function withRemoteControl(config) {
  config = copyKotlinSources(config)
  config = registerPackageInMainApplication(config)
  config = declareServiceInManifest(config)
  return config
}
