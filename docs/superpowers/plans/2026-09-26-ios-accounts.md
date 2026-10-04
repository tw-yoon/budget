# iPhone App — Accounts (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native SwiftUI iPhone app whose Accounts screen reads and edits the Budget server's data through its existing HTTP API.

**Architecture:** A hand-written Xcode project in `budget-claude/ios/` using folder-synchronized groups, so adding a Swift file never touches `project.pbxproj`. Pure, unit-tested logic (formatters, models, payment status, patch diffing, networking, a `@MainActor @Observable` store) under thin SwiftUI views. The server is unchanged.

**Tech Stack:** Swift 6, SwiftUI, Observation, Swift Testing, URLSession. iOS 26, Xcode 26.3. No third-party packages.

**Spec:** `docs/superpowers/specs/2026-09-26-ios-accounts-design.md` — read it first.

**Provenance:** every file below was compiled and its tests run (47 passing) on the iPhone 17 Pro simulator on 2026-09-26, and the finished app was run against a live Budget server. The code is meant to be used as written.

## Global Constraints

- Work in the `ios-accounts` worktree, never on `main`. All paths below are relative to `budget-claude/`; run `xcodebuild` from `budget-claude/ios/`.
- iOS 26.0 deployment target, iPhone only (`TARGETED_DEVICE_FAMILY = 1`), Swift 6 language mode, **default actor isolation left at nonisolated** (the store is `@MainActor` explicitly; models and logic stay nonisolated so tests can use them directly).
- No third-party packages. No XcodeGen/Tuist.
- The repo is published publicly: no Team ID, hostname, home-directory path, real institution names or real balances in any tracked file. Fixtures use invented data. `bash scripts/test-scrub.sh` must pass after every commit.
- The server address is entered at runtime and stored in `UserDefaults` under the key `serverURL`. Never compile one in.
- PATCH bodies carry only changed keys (`AccountPatch`); `null` clears a field.
- Payment-status text must match the web's `paymentStatus` exactly, including the round-up quirk ("in 1d" for later today).
- Simulator: **iPhone 17 Pro** (402×874 pt, same as the iPhone 16 Pro; no 16 Pro simulator is installed).
- Test command (from `ios/`): `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `ios/BudgetPhone.xcodeproj/project.pbxproj` | Two targets (app, unit tests), synced folders, xcconfig base |
| `ios/BudgetPhone.xcodeproj/xcshareddata/xcschemes/BudgetPhone.xcscheme` | Shared scheme so `xcodebuild test` finds the test target |
| `ios/Config/Shared.xcconfig` | Deployment target, Swift settings, bundle id prefix; optionally includes `Local.xcconfig` |
| `ios/Config/Local.example.xcconfig` | Template for the gitignored signing file |
| `ios/Config/Info.plist` | Display name, local-network ATS exception and usage string |
| `ios/BudgetPhone/Assets.xcassets` | Placeholder app icon, accent colour |
| `ios/BudgetPhone/Support/Formatters.swift` | Currency, date, relative-time, ISO parsing — matching `src/lib/format.ts` |
| `ios/BudgetPhone/Models/AccountModels.swift` | Codable mirrors of the API types + row-text helpers |
| `ios/BudgetPhone/Models/AccountPatch.swift` | Three-state PATCH body; `AccountEditForm` diff and validation |
| `ios/BudgetPhone/Accounts/PaymentStatus.swift` | Port of the web's due-date line |
| `ios/BudgetPhone/Networking/ServerAddress.swift` | Validating and reading the saved server URL |
| `ios/BudgetPhone/Networking/APIClient.swift` | The three API calls; `APIError` |
| `ios/BudgetPhone/Accounts/AccountsStore.swift` | Load / refresh / save and how failures surface |
| `ios/BudgetPhone/App/*.swift`, `Accounts/*View.swift`, `Accounts/AccountRow.swift`, `Accounts/NetWorthHeader.swift`, `Settings/*.swift` | SwiftUI |
| `ios/BudgetPhoneTests/*` | Swift Testing suites, `TestSupport.swift` (fixtures, stub URL protocol), `Fixtures/accounts.json` |
| `ios/README.md` | Running in the simulator and on a phone with a free Apple ID |
| `.gitignore` | Ignore `Local.xcconfig`, build output, `xcuserdata` |

---

### Task 1: Xcode project scaffold

**Files:**
- Create: `ios/BudgetPhone.xcodeproj/project.pbxproj`, `ios/BudgetPhone.xcodeproj/xcshareddata/xcschemes/BudgetPhone.xcscheme`
- Create: `ios/Config/Shared.xcconfig`, `ios/Config/Local.example.xcconfig`, `ios/Config/Info.plist`
- Create: `ios/BudgetPhone/Assets.xcassets/{Contents.json, AppIcon.appiconset/Contents.json, AccentColor.colorset/Contents.json}`
- Create: `ios/BudgetPhone/App/BudgetPhoneApp.swift` (placeholder, replaced in Task 6)
- Test: `ios/BudgetPhoneTests/SmokeTests.swift` (deleted in Task 2)
- Modify: `.gitignore` (append)

**Interfaces:**
- Produces: app module `BudgetPhone` (importable with `@testable import BudgetPhone`), test target `BudgetPhoneTests`, scheme `BudgetPhone`. Any `.swift` file placed under `ios/BudgetPhone/` joins the app target automatically; under `ios/BudgetPhoneTests/`, the test target. Non-Swift files there (e.g. `Fixtures/accounts.json`) are copied into that bundle as resources.

The project file is hand-written. Object IDs are arbitrary 24-hex strings; keep them as given so later diffs stay readable. `Info.plist` sits in `Config/`, outside the synced app folder — inside it, Xcode would also try to copy it as a resource and fail with "Multiple commands produce Info.plist".

- [ ] **Step 1: Write the smoke test**

`ios/BudgetPhoneTests/SmokeTests.swift`:

```swift
import SwiftUI
import Testing
@testable import BudgetPhone

// Proves the test target builds, links against the app, and runs. Replaced by
// real suites in Task 2.
@Test func appModuleLinks() {
  #expect(String(describing: BudgetPhoneApp.self) == "BudgetPhoneApp")
}
```

- [ ] **Step 2: Create the project and configuration files**

`ios/BudgetPhone.xcodeproj/project.pbxproj`:

```
// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {
	};
	objectVersion = 77;
	objects = {

/* Begin PBXContainerItemProxy section */
		B0000000000000000000A001 /* PBXContainerItemProxy */ = {
			isa = PBXContainerItemProxy;
			containerPortal = B0000000000000000000F001 /* Project object */;
			proxyType = 1;
			remoteGlobalIDString = B0000000000000000000C001;
			remoteInfo = BudgetPhone;
		};
/* End PBXContainerItemProxy section */

/* Begin PBXFileReference section */
		B0000000000000000000D001 /* BudgetPhone.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = BudgetPhone.app; sourceTree = BUILT_PRODUCTS_DIR; };
		B0000000000000000000D002 /* BudgetPhoneTests.xctest */ = {isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = BudgetPhoneTests.xctest; sourceTree = BUILT_PRODUCTS_DIR; };
		B0000000000000000000D003 /* Shared.xcconfig */ = {isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Shared.xcconfig; sourceTree = "<group>"; };
		B0000000000000000000D004 /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };
/* End PBXFileReference section */

/* Begin PBXFileSystemSynchronizedRootGroup section */
		B0000000000000000000E001 /* BudgetPhone */ = {isa = PBXFileSystemSynchronizedRootGroup; path = BudgetPhone; sourceTree = "<group>"; };
		B0000000000000000000E002 /* BudgetPhoneTests */ = {isa = PBXFileSystemSynchronizedRootGroup; path = BudgetPhoneTests; sourceTree = "<group>"; };
/* End PBXFileSystemSynchronizedRootGroup section */

/* Begin PBXFrameworksBuildPhase section */
		B0000000000000000000B011 /* Frameworks */ = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
		B0000000000000000000B021 /* Frameworks */ = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		B00000000000000000009001 = {
			isa = PBXGroup;
			children = (
				B00000000000000000009003 /* Config */,
				B0000000000000000000E001 /* BudgetPhone */,
				B0000000000000000000E002 /* BudgetPhoneTests */,
				B00000000000000000009002 /* Products */,
			);
			sourceTree = "<group>";
		};
		B00000000000000000009002 /* Products */ = {
			isa = PBXGroup;
			children = (
				B0000000000000000000D001 /* BudgetPhone.app */,
				B0000000000000000000D002 /* BudgetPhoneTests.xctest */,
			);
			name = Products;
			sourceTree = "<group>";
		};
		B00000000000000000009003 /* Config */ = {
			isa = PBXGroup;
			children = (
				B0000000000000000000D003 /* Shared.xcconfig */,
				B0000000000000000000D004 /* Info.plist */,
			);
			path = Config;
			sourceTree = "<group>";
		};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		B0000000000000000000C001 /* BudgetPhone */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = B00000000000000000008002 /* Build configuration list for PBXNativeTarget "BudgetPhone" */;
			buildPhases = (
				B0000000000000000000B010 /* Sources */,
				B0000000000000000000B011 /* Frameworks */,
				B0000000000000000000B012 /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			fileSystemSynchronizedGroups = (
				B0000000000000000000E001 /* BudgetPhone */,
			);
			name = BudgetPhone;
			productName = BudgetPhone;
			productReference = B0000000000000000000D001 /* BudgetPhone.app */;
			productType = "com.apple.product-type.application";
		};
		B0000000000000000000C002 /* BudgetPhoneTests */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = B00000000000000000008003 /* Build configuration list for PBXNativeTarget "BudgetPhoneTests" */;
			buildPhases = (
				B0000000000000000000B020 /* Sources */,
				B0000000000000000000B021 /* Frameworks */,
				B0000000000000000000B022 /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
				B00000000000000000007001 /* PBXTargetDependency */,
			);
			fileSystemSynchronizedGroups = (
				B0000000000000000000E002 /* BudgetPhoneTests */,
			);
			name = BudgetPhoneTests;
			productName = BudgetPhoneTests;
			productReference = B0000000000000000000D002 /* BudgetPhoneTests.xctest */;
			productType = "com.apple.product-type.bundle.unit-test";
		};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		B0000000000000000000F001 /* Project object */ = {
			isa = PBXProject;
			attributes = {
				BuildIndependentTargetsInParallel = 1;
				LastSwiftUpdateCheck = 2630;
				LastUpgradeCheck = 2630;
				TargetAttributes = {
					B0000000000000000000C001 = {
						CreatedOnToolsVersion = 26.3;
					};
					B0000000000000000000C002 = {
						CreatedOnToolsVersion = 26.3;
						TestTargetID = B0000000000000000000C001;
					};
				};
			};
			buildConfigurationList = B00000000000000000008001 /* Build configuration list for PBXProject "BudgetPhone" */;
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (
				en,
				Base,
			);
			mainGroup = B00000000000000000009001;
			minimizedProjectReferenceProxies = 1;
			preferredProjectObjectVersion = 77;
			productRefGroup = B00000000000000000009002 /* Products */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				B0000000000000000000C001 /* BudgetPhone */,
				B0000000000000000000C002 /* BudgetPhoneTests */,
			);
		};
/* End PBXProject section */

/* Begin PBXResourcesBuildPhase section */
		B0000000000000000000B012 /* Resources */ = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
		B0000000000000000000B022 /* Resources */ = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXResourcesBuildPhase section */

/* Begin PBXSourcesBuildPhase section */
		B0000000000000000000B010 /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
		B0000000000000000000B020 /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXSourcesBuildPhase section */

/* Begin PBXTargetDependency section */
		B00000000000000000007001 /* PBXTargetDependency */ = {
			isa = PBXTargetDependency;
			target = B0000000000000000000C001 /* BudgetPhone */;
			targetProxy = B0000000000000000000A001 /* PBXContainerItemProxy */;
		};
/* End PBXTargetDependency section */

/* Begin XCBuildConfiguration section */
		B00000000000000000006001 /* Debug */ = {
			isa = XCBuildConfiguration;
			baseConfigurationReference = B0000000000000000000D003 /* Shared.xcconfig */;
			buildSettings = {
				DEBUG_INFORMATION_FORMAT = dwarf;
				ENABLE_TESTABILITY = YES;
				GCC_OPTIMIZATION_LEVEL = 0;
				ONLY_ACTIVE_ARCH = YES;
				SWIFT_ACTIVE_COMPILATION_CONDITIONS = "DEBUG $(inherited)";
				SWIFT_OPTIMIZATION_LEVEL = "-Onone";
			};
			name = Debug;
		};
		B00000000000000000006002 /* Release */ = {
			isa = XCBuildConfiguration;
			baseConfigurationReference = B0000000000000000000D003 /* Shared.xcconfig */;
			buildSettings = {
				DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
				SWIFT_COMPILATION_MODE = wholemodule;
				VALIDATE_PRODUCT = YES;
			};
			name = Release;
		};
		B00000000000000000006011 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor;
				INFOPLIST_FILE = Config/Info.plist;
				PRODUCT_BUNDLE_IDENTIFIER = "$(BUNDLE_ID_PREFIX).BudgetPhone";
				PRODUCT_NAME = "$(TARGET_NAME)";
			};
			name = Debug;
		};
		B00000000000000000006012 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor;
				INFOPLIST_FILE = Config/Info.plist;
				PRODUCT_BUNDLE_IDENTIFIER = "$(BUNDLE_ID_PREFIX).BudgetPhone";
				PRODUCT_NAME = "$(TARGET_NAME)";
			};
			name = Release;
		};
		B00000000000000000006021 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				BUNDLE_LOADER = "$(TEST_HOST)";
				GENERATE_INFOPLIST_FILE = YES;
				PRODUCT_BUNDLE_IDENTIFIER = "$(BUNDLE_ID_PREFIX).BudgetPhoneTests";
				PRODUCT_NAME = "$(TARGET_NAME)";
				TEST_HOST = "$(BUILT_PRODUCTS_DIR)/BudgetPhone.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/BudgetPhone";
			};
			name = Debug;
		};
		B00000000000000000006022 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				BUNDLE_LOADER = "$(TEST_HOST)";
				GENERATE_INFOPLIST_FILE = YES;
				PRODUCT_BUNDLE_IDENTIFIER = "$(BUNDLE_ID_PREFIX).BudgetPhoneTests";
				PRODUCT_NAME = "$(TARGET_NAME)";
				TEST_HOST = "$(BUILT_PRODUCTS_DIR)/BudgetPhone.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/BudgetPhone";
			};
			name = Release;
		};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		B00000000000000000008001 /* Build configuration list for PBXProject "BudgetPhone" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				B00000000000000000006001 /* Debug */,
				B00000000000000000006002 /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
		B00000000000000000008002 /* Build configuration list for PBXNativeTarget "BudgetPhone" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				B00000000000000000006011 /* Debug */,
				B00000000000000000006012 /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
		B00000000000000000008003 /* Build configuration list for PBXNativeTarget "BudgetPhoneTests" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				B00000000000000000006021 /* Debug */,
				B00000000000000000006022 /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
/* End XCConfigurationList section */
	};
	rootObject = B0000000000000000000F001 /* Project object */;
}
```

`ios/BudgetPhone.xcodeproj/xcshareddata/xcschemes/BudgetPhone.xcscheme`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "2630" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "B0000000000000000000C001" BuildableName = "BudgetPhone.app" BlueprintName = "BudgetPhone" ReferencedContainer = "container:BudgetPhone.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
         <TestableReference skipped = "NO" parallelizable = "YES">
            <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "B0000000000000000000C002" BuildableName = "BudgetPhoneTests.xctest" BlueprintName = "BudgetPhoneTests" ReferencedContainer = "container:BudgetPhone.xcodeproj">
            </BuildableReference>
         </TestableReference>
      </Testables>
   </TestAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "B0000000000000000000C001" BuildableName = "BudgetPhone.app" BlueprintName = "BudgetPhone" ReferencedContainer = "container:BudgetPhone.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration = "Release" shouldUseLaunchSchemeArgsEnv = "YES" savedToolIdentifier = "" useCustomWorkingDirectory = "NO" debugDocumentVersioning = "YES">
   </ProfileAction>
   <AnalyzeAction buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
```

`ios/Config/Shared.xcconfig`:

```
// Settings shared by every target and configuration. Machine-specific values
// (the signing team) live in Local.xcconfig, which is gitignored; copy
// Local.example.xcconfig to create it.
IPHONEOS_DEPLOYMENT_TARGET = 26.0
SDKROOT = iphoneos
TARGETED_DEVICE_FAMILY = 1
SUPPORTED_PLATFORMS = iphoneos iphonesimulator
SWIFT_VERSION = 6.0
SWIFT_UPCOMING_FEATURE_MEMBER_IMPORT_VISIBILITY = YES
MARKETING_VERSION = 0.1.0
CURRENT_PROJECT_VERSION = 1
CODE_SIGN_STYLE = Automatic
ENABLE_USER_SCRIPT_SANDBOXING = YES
ENABLE_PREVIEWS = YES
CLANG_ENABLE_MODULES = YES
LD_RUNPATH_SEARCH_PATHS = $(inherited) @executable_path/Frameworks
BUNDLE_ID_PREFIX = local.budget

#include? "Local.xcconfig"
```

`ios/Config/Local.example.xcconfig`:

```
// Copy to Local.xcconfig (gitignored) and fill in your own values.
//
// DEVELOPMENT_TEAM is the ten-character Team ID Xcode shows under
// Signing & Capabilities once you pick your Personal Team. Needed only to
// run on a physical iPhone; the simulator builds without it.
DEVELOPMENT_TEAM =

// Bundle IDs must be unique per Apple ID. Change this if Xcode reports the
// identifier is taken.
BUNDLE_ID_PREFIX = local.budget
```

`ios/Config/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>$(DEVELOPMENT_LANGUAGE)</string>
	<key>CFBundleDisplayName</key>
	<string>Budget</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>CFBundlePackageType</key>
	<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
	<key>CFBundleShortVersionString</key>
	<string>$(MARKETING_VERSION)</string>
	<key>CFBundleVersion</key>
	<string>$(CURRENT_PROJECT_VERSION)</string>
	<key>LSRequiresIPhoneOS</key>
	<true/>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsLocalNetworking</key>
		<true/>
	</dict>
	<key>NSLocalNetworkUsageDescription</key>
	<string>Budget connects to the Budget server on your Mac over your network.</string>
	<key>UIApplicationSceneManifest</key>
	<dict>
		<key>UIApplicationSupportsMultipleScenes</key>
		<false/>
	</dict>
	<key>UILaunchScreen</key>
	<dict/>
	<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>
</dict>
</plist>
```

`ios/BudgetPhone/Assets.xcassets/Contents.json`:

```json
{"info":{"author":"xcode","version":1}}
```

`ios/BudgetPhone/Assets.xcassets/AppIcon.appiconset/Contents.json`:

```json
{"images":[{"idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}
```

`ios/BudgetPhone/Assets.xcassets/AccentColor.colorset/Contents.json`:

```json
{"colors":[{"idiom":"universal"}],"info":{"author":"xcode","version":1}}
```

`ios/BudgetPhone/App/BudgetPhoneApp.swift` (placeholder):

```swift
import SwiftUI

@main
struct BudgetPhoneApp: App {
  var body: some Scene {
    WindowGroup { Text("Budget") }
  }
}
```

Append to `.gitignore`:

```
# iPhone app: local signing settings and build output
/ios/Config/Local.xcconfig
/ios/build/
xcuserdata/
```

- [ ] **Step 3: Run the tests**

Run (from `ios/`): `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: exit 0; `appModuleLinks()` passes. The first run takes a couple of minutes while the simulator clones.

If the simulator is missing: `xcrun simctl list devices available | grep 'iPhone 17 Pro'`. If it is booted and a run hangs, `xcrun simctl shutdown all` and retry.

- [ ] **Step 4: Check nothing unwanted is tracked**

Run: `git status --short` (from `budget-claude/`)
Expected: only `.gitignore` and files under `ios/`; no `build/`, no `xcuserdata`. Then `bash scripts/test-scrub.sh` → `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add .gitignore ios
git commit -m "Scaffold the iPhone app's Xcode project

Hand-written project with folder-synchronized groups, a shared scheme,
and xcconfig-based settings. Signing lives in a gitignored Local.xcconfig.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Formatters and models

**Files:**
- Create: `ios/BudgetPhone/Support/Formatters.swift`, `ios/BudgetPhone/Models/AccountModels.swift`
- Test: `ios/BudgetPhoneTests/TestSupport.swift`, `ios/BudgetPhoneTests/Fixtures/accounts.json`, `ios/BudgetPhoneTests/ModelTests.swift`
- Delete: `ios/BudgetPhoneTests/SmokeTests.swift`

**Interfaces:**
- Produces:
  - `enum Formatters { static func currency(_: Double) -> String; static func date(_: Date, calendar: Calendar = .current) -> String; static func relative(_: Date, now: Date = .now) -> String; static func plainNumber(_: Double) -> String; static func parseISO(_: String) -> Date? }`
  - `struct AccountDTO: Codable, Identifiable, Equatable, Sendable` (fields exactly as the API), with `isCredit`, `title`, `subtitle`, `signedBalance`, `available: Double?`, `availableLabel`, `availableWorthShowing: Double?`
  - `struct AccountGroup` (`id` = `type`, `signedSubtotal`), `struct AccountsSummary`, `struct AccountsResponse { groups; summary }`, `struct RefreshResult { errors: [ItemError] }` with `ItemError { itemId; institution; error }`
  - Test helpers: `TestData.accountsJSON() throws -> Data`, `TestData.accounts() throws -> AccountsResponse`, `TestData.card(manualDueDay:nextPaymentDueDate:minimumPaymentAmount:paymentIsOverdue:displayName:manualCreditLimit:type:) -> AccountDTO` (balance 100, available 900), and `StubURLProtocol` (used from Task 5).

`TestSupport.swift` is written in full now, including `StubURLProtocol`, which Task 5 uses.

- [ ] **Step 1: Write the fixture, the support file and the failing tests; delete the smoke test**

The fixture is invented. Keep it that way — never paste a real `/api/accounts` response here.

`ios/BudgetPhoneTests/Fixtures/accounts.json`:

```json
{
  "groups": [
    {
      "type": "DEPOSITORY",
      "label": "Cash",
      "subtotal": 4210.5,
      "isLiability": false,
      "accounts": [
        {
          "id": "acc-checking",
          "name": "Everyday Checking",
          "officialName": "Example Bank Everyday Checking",
          "mask": "0001",
          "type": "DEPOSITORY",
          "subtype": "checking",
          "currentBalance": 4210.5,
          "availableBalance": 4100,
          "balanceFetchedAt": "2026-09-26T15:00:00.000Z",
          "institution": "Example Bank",
          "isLiability": false,
          "nextPaymentDueDate": null,
          "lastStatementBalance": null,
          "minimumPaymentAmount": null,
          "paymentIsOverdue": null,
          "displayName": null,
          "manualDueDay": null,
          "manualCreditLimit": null
        }
      ]
    },
    {
      "type": "CREDIT",
      "label": "Credit cards",
      "subtotal": 812.34,
      "isLiability": true,
      "accounts": [
        {
          "id": "acc-card",
          "name": "Sample Rewards Card",
          "officialName": null,
          "mask": "0002",
          "type": "CREDIT",
          "subtype": "credit card",
          "currentBalance": 812.34,
          "availableBalance": null,
          "balanceFetchedAt": "2026-09-26T15:00:00.000Z",
          "institution": "Sample Card Co",
          "isLiability": true,
          "nextPaymentDueDate": "2026-10-05T00:00:00.000Z",
          "lastStatementBalance": 640,
          "minimumPaymentAmount": 35,
          "paymentIsOverdue": false,
          "displayName": "Groceries card",
          "manualDueDay": null,
          "manualCreditLimit": 5000
        }
      ]
    }
  ],
  "summary": {
    "totalAssets": 4210.5,
    "totalLiabilities": 812.34,
    "netWorth": 3398.16,
    "accountCount": 2,
    "lastRefreshed": "2026-09-26T15:00:00.000Z"
  },
  "banks": [{ "itemId": "item-1", "institution": "Example Bank", "accountCount": 1 }],
  "debitCards": []
}
```

`ios/BudgetPhoneTests/TestSupport.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

enum TestData {
  /// The invented response in Fixtures/accounts.json.
  static func accountsJSON() throws -> Data {
    let url = try #require(Bundle(for: BundleToken.self).url(forResource: "accounts", withExtension: "json"))
    return try Data(contentsOf: url)
  }

  static func accounts() throws -> AccountsResponse {
    try JSONDecoder().decode(AccountsResponse.self, from: accountsJSON())
  }

  /// A credit account with every due-date field at a neutral default.
  static func card(
    manualDueDay: Int? = nil,
    nextPaymentDueDate: String? = nil,
    minimumPaymentAmount: Double? = nil,
    paymentIsOverdue: Bool? = nil,
    displayName: String? = nil,
    manualCreditLimit: Double? = nil,
    type: String = "CREDIT"
  ) -> AccountDTO {
    AccountDTO(
      id: "card", name: "Sample Card", officialName: nil, mask: "0002", type: type,
      subtype: "credit card", currentBalance: 100, availableBalance: 900,
      balanceFetchedAt: "2026-09-26T15:00:00.000Z", institution: "Sample Card Co",
      isLiability: type == "CREDIT", nextPaymentDueDate: nextPaymentDueDate,
      lastStatementBalance: nil, minimumPaymentAmount: minimumPaymentAmount,
      paymentIsOverdue: paymentIsOverdue, displayName: displayName,
      manualDueDay: manualDueDay, manualCreditLimit: manualCreditLimit)
  }
}

private final class BundleToken {}

/// Answers URLSession requests from a handler instead of the network, and
/// records what was sent. Tests that use it are `.serialized`, since the
/// handler is shared.
final class StubURLProtocol: URLProtocol {
  nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?
  nonisolated(unsafe) static var requests: [URLRequest] = []

  static func session(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> URLSession {
    self.handler = handler
    requests = []
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubURLProtocol.self]
    return URLSession(configuration: config)
  }

  /// URLSession moves the body into a stream before it reaches a protocol.
  static func body(of request: URLRequest) -> Data? {
    if let data = request.httpBody { return data }
    guard let stream = request.httpBodyStream else { return nil }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
      let n = stream.read(&buffer, maxLength: buffer.count)
      if n <= 0 { break }
      data.append(buffer, count: n)
    }
    return data
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    Self.requests.append(request)
    do {
      let (status, data) = try Self.handler!(request)
      let response = HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }

  override func stopLoading() {}
}
```

`ios/BudgetPhoneTests/ModelTests.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

struct ModelTests {
  @Test func decodesTheAccountsResponseAndIgnoresUnusedKeys() throws {
    let response = try TestData.accounts()
    #expect(response.groups.map(\.type) == ["DEPOSITORY", "CREDIT"])
    #expect(response.summary.accountCount == 2)
    #expect(response.summary.netWorth == 3398.16)
    let card = response.groups[1].accounts[0]
    #expect(card.displayName == "Groceries card")
    #expect(card.manualCreditLimit == 5000)
    #expect(card.manualDueDay == nil)
  }

  @Test func liabilitiesPrintNegative() throws {
    let response = try TestData.accounts()
    #expect(response.groups[0].signedSubtotal == 4210.5)
    #expect(response.groups[1].signedSubtotal == -812.34)
    #expect(response.groups[1].accounts[0].signedBalance == -812.34)
  }

  @Test func rowTextMatchesTheWebCard() throws {
    let response = try TestData.accounts()
    let checking = response.groups[0].accounts[0]
    let card = response.groups[1].accounts[0]
    #expect(checking.title == "Everyday Checking")
    #expect(checking.subtitle == "··0001 · checking · Example Bank")
    #expect(card.title == "Groceries card")
    #expect(card.availableLabel == "Available credit")
    // A manual limit derives available credit: 5000 − 812.34.
    #expect(abs(card.available! - 4187.66) < 0.001)
    #expect(checking.available == 4100)
  }

  @Test func availableIsShownOnlyWhenItDiffersFromTheBalance() throws {
    let response = try TestData.accounts()
    #expect(response.groups[0].accounts[0].availableWorthShowing == 4100)
    let same = TestData.card(type: "DEPOSITORY")  // balance 100, available 900
    #expect(same.availableWorthShowing == 900)
    let equal = AccountDTO(
      id: "e", name: "Savings", officialName: nil, mask: nil, type: "DEPOSITORY",
      subtype: "savings", currentBalance: 250, availableBalance: 250,
      balanceFetchedAt: "2026-09-26T15:00:00.000Z", institution: "Example Bank",
      isLiability: false, nextPaymentDueDate: nil, lastStatementBalance: nil,
      minimumPaymentAmount: nil, paymentIsOverdue: nil, displayName: nil,
      manualDueDay: nil, manualCreditLimit: nil)
    #expect(equal.availableWorthShowing == nil)
  }

  @Test func subtitleFallsBackToTypeAndSkipsAMissingMask() {
    let account = AccountDTO(
      id: "x", name: "Brokerage", officialName: nil, mask: nil, type: "INVESTMENT",
      subtype: nil, currentBalance: 1, availableBalance: nil,
      balanceFetchedAt: "2026-09-26T15:00:00.000Z", institution: "Example Invest",
      isLiability: false, nextPaymentDueDate: nil, lastStatementBalance: nil,
      minimumPaymentAmount: nil, paymentIsOverdue: nil, displayName: nil,
      manualDueDay: nil, manualCreditLimit: nil)
    #expect(account.subtitle == "investment · Example Invest")
  }

  @Test func formattersMatchTheWeb() throws {
    #expect(Formatters.currency(1234.5) == "$1,234.50")
    #expect(Formatters.currency(-812.34) == "-$812.34")
    let now = try #require(Formatters.parseISO("2026-09-26T15:00:00.000Z"))
    #expect(Formatters.relative(now.addingTimeInterval(-30), now: now) == "just now")
    #expect(Formatters.relative(now.addingTimeInterval(-4 * 60), now: now) == "4m ago")
    #expect(Formatters.relative(now.addingTimeInterval(-3 * 3600), now: now) == "3h ago")
    #expect(Formatters.relative(now.addingTimeInterval(-50 * 3600), now: now) == "2d ago")
    #expect(Formatters.plainNumber(5000) == "5000")
    #expect(Formatters.plainNumber(5000.5) == "5000.5")
    #expect(Formatters.parseISO("2026-10-05T00:00:00Z") != nil)
    #expect(Formatters.parseISO("2026-10-05") != nil)
    #expect(Formatters.parseISO("not a date") == nil)
  }
}
```

```bash
git rm -q ios/BudgetPhoneTests/SmokeTests.swift
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: build fails — `cannot find 'Formatters' in scope`, `cannot find type 'AccountsResponse' in scope`.

- [ ] **Step 3: Implement**

The formatters mirror `src/lib/format.ts` (`formatCurrency`, `formatDate`, `formatRelativeTime`). The models mirror `src/types/index.ts`; property names equal the JSON keys, so no `CodingKeys`. `banks` and `debitCards` in the response are deliberately not modelled — `Decodable` ignores unknown keys.

`ios/BudgetPhone/Support/Formatters.swift`:

```swift
import Foundation

// Formatting that matches the web app's src/lib/format.ts, so the phone and
// the browser print the same strings for the same data.
enum Formatters {
  private static let enUS = Locale(identifier: "en_US")

  /// "$1,234.56", "-$12.00" — Intl.NumberFormat("en-US", currency USD).
  static func currency(_ amount: Double) -> String {
    amount.formatted(.currency(code: "USD").locale(enUS))
  }

  /// "Sep 26, 2026" — formatDate, in the calendar's time zone.
  static func date(_ date: Date, calendar: Calendar = .current) -> String {
    let f = DateFormatter()
    f.locale = enUS
    f.timeZone = calendar.timeZone
    f.dateFormat = "MMM d, yyyy"
    return f.string(from: date)
  }

  /// "just now", "4m ago", "3h ago", "2d ago" — formatRelativeTime.
  static func relative(_ date: Date, now: Date = .now) -> String {
    let sec = max(0, Int(now.timeIntervalSince(date)))
    if sec < 60 { return "just now" }
    let min = sec / 60
    if min < 60 { return "\(min)m ago" }
    let hr = min / 60
    if hr < 24 { return "\(hr)h ago" }
    return "\(hr / 24)d ago"
  }

  /// Plain number for an edit field: 5000 → "5000", 5000.5 → "5000.5".
  static func plainNumber(_ value: Double) -> String {
    value.formatted(.number.grouping(.never).locale(enUS))
  }

  /// Parses the ISO strings the API sends — Prisma's
  /// "2026-10-05T00:00:00.000Z", the same without fractional seconds, or a
  /// bare "2026-10-05", which JavaScript reads as UTC midnight.
  static func parseISO(_ s: String) -> Date? {
    for options: ISO8601DateFormatter.Options in [
      [.withInternetDateTime, .withFractionalSeconds],
      [.withInternetDateTime],
      [.withFullDate],
    ] {
      let f = ISO8601DateFormatter()
      f.formatOptions = options
      f.timeZone = .gmt
      if let d = f.date(from: s) { return d }
    }
    return nil
  }
}
```

`ios/BudgetPhone/Models/AccountModels.swift`:

```swift
import Foundation

// Mirrors of src/types/index.ts. Property names match the JSON keys exactly,
// so Codable needs no key mapping. Dates stay ISO strings, as they do in the
// web code; Formatters.parseISO reads them where they are used.

struct AccountDTO: Codable, Identifiable, Equatable, Sendable {
  let id: String
  let name: String
  let officialName: String?
  let mask: String?
  let type: String  // DEPOSITORY | CREDIT | INVESTMENT | LOAN | OTHER
  let subtype: String?
  let currentBalance: Double
  let availableBalance: Double?
  let balanceFetchedAt: String
  let institution: String
  let isLiability: Bool
  let nextPaymentDueDate: String?
  let lastStatementBalance: Double?
  let minimumPaymentAmount: Double?
  let paymentIsOverdue: Bool?
  let displayName: String?
  let manualDueDay: Int?
  let manualCreditLimit: Double?
}

struct AccountGroup: Codable, Identifiable, Equatable, Sendable {
  let type: String
  let label: String
  let subtotal: Double
  let isLiability: Bool
  let accounts: [AccountDTO]

  var id: String { type }
  /// Liability groups print negative, as on the web.
  var signedSubtotal: Double { isLiability ? -subtotal : subtotal }
}

struct AccountsSummary: Codable, Equatable, Sendable {
  let totalAssets: Double
  let totalLiabilities: Double
  let netWorth: Double
  let accountCount: Int
  let lastRefreshed: String?
}

/// GET /api/accounts. The response also carries `banks` and `debitCards`,
/// which the phone does not use and so does not decode.
struct AccountsResponse: Codable, Equatable, Sendable {
  let groups: [AccountGroup]
  let summary: AccountsSummary
}

/// POST /api/plaid/refresh-balances. Only the per-bank failures matter here;
/// `updated` and `liabilities` are ignored.
struct RefreshResult: Decodable, Equatable, Sendable {
  struct ItemError: Decodable, Equatable, Sendable {
    let itemId: String
    let institution: String
    let error: String
  }
  let errors: [ItemError]
}

extension AccountDTO {
  var isCredit: Bool { type == "CREDIT" }
  var title: String { displayName ?? name }

  /// "··1234 · checking · Chase" — the web card's second line.
  var subtitle: String {
    [mask.map { "··\($0)" }, subtype ?? type.lowercased(), institution]
      .compactMap { $0 }
      .joined(separator: " · ")
  }

  var signedBalance: Double { isLiability ? -currentBalance : currentBalance }

  /// A manual credit limit derives available credit; otherwise Plaid's figure.
  var available: Double? {
    manualCreditLimit.map { $0 - currentBalance } ?? availableBalance
  }

  var availableLabel: String { isLiability ? "Available credit" : "Available" }

  /// The phone shows "Available" only when it adds something. For most cash
  /// accounts it equals the balance, and repeating it squeezes the name on a
  /// 402pt screen. (The web always shows it; it has the width.)
  var availableWorthShowing: Double? {
    guard let available, abs(available - currentBalance) >= 0.005 else { return nil }
    return available
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: exit 0, all `ModelTests` pass.

- [ ] **Step 5: Commit**

```bash
git add ios
git commit -m "Add the iPhone app's models and formatters

Codable mirrors of the accounts API and formatters that match the web's
format.ts, tested against an invented fixture.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Payment status

**Files:**
- Create: `ios/BudgetPhone/Accounts/PaymentStatus.swift`
- Test: `ios/BudgetPhoneTests/PaymentStatusTests.swift`

**Interfaces:**
- Consumes: `AccountDTO`, `Formatters.date/currency/parseISO`, `TestData.card(...)`.
- Produces: `struct PaymentStatus: Equatable { enum Tone { normal, soon, overdue }; let text: String; let tone: Tone; static func of(_: AccountDTO, now: Date = .now, calendar: Calendar = .current) -> PaymentStatus? }`, and free functions `daysUntil(_: Date, now: Date) -> Int`, `nextMonthlyOccurrence(day: Int, now: Date, calendar: Calendar) -> Date`.

This is a line-for-line port of `paymentStatus` in `src/components/AccountCard.tsx` plus `daysUntil` and `nextMonthlyOccurrence` from `src/lib/format.ts`. Read those first. Keep the web's behaviour even where it is odd — the tests pin it (see `dueLaterTodayReadsInOneDayLikeTheWeb`). Tests pin the calendar to America/Chicago and `now` to 09:00 local on 2026-09-26 (CDT, UTC−5).

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/PaymentStatusTests.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

/// Pinned to Chicago and a fixed instant so every branch is deterministic.
struct PaymentStatusTests {
  let calendar: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "America/Chicago")!
    return c
  }()

  /// Local 09:00 on the given day.
  func at(_ y: Int, _ m: Int, _ d: Int, hour: Int = 9) -> Date {
    calendar.date(from: DateComponents(year: y, month: m, day: d, hour: hour))!
  }

  func status(_ account: AccountDTO, now: Date) -> PaymentStatus? {
    PaymentStatus.of(account, now: now, calendar: calendar)
  }

  @Test func nonCreditAccountsHaveNone() {
    #expect(status(TestData.card(nextPaymentDueDate: "2026-10-05T17:00:00Z", type: "DEPOSITORY"), now: at(2026, 9, 26)) == nil)
  }

  @Test func creditWithoutADueDateHasNone() {
    #expect(status(TestData.card(), now: at(2026, 9, 26)) == nil)
  }

  @Test func plaidDueDateInTheFuture() {
    let s = status(
      TestData.card(nextPaymentDueDate: "2026-10-15T17:00:00Z", minimumPaymentAmount: 35),
      now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment due Oct 15, 2026 · in 20d · min $35.00", tone: .normal))
  }

  @Test func withinSevenDaysIsSoon() {
    let s = status(TestData.card(nextPaymentDueDate: "2026-10-03T14:00:00Z"), now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment due Oct 3, 2026 · in 7d", tone: .soon))
  }

  @Test func eightDaysOutIsNormal() {
    let s = status(TestData.card(nextPaymentDueDate: "2026-10-04T14:00:00Z"), now: at(2026, 9, 26))
    #expect(s?.tone == .normal)
    #expect(s?.text == "Payment due Oct 4, 2026 · in 8d")
  }

  @Test func dueEarlierTodayReadsToday() {
    // 13:30Z is 08:30 in Chicago, half an hour before `now`.
    let s = status(TestData.card(nextPaymentDueDate: "2026-09-26T13:30:00Z"), now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment due Sep 26, 2026 · today", tone: .soon))
  }

  @Test func dueLaterTodayReadsInOneDayLikeTheWeb() {
    // daysUntil rounds up, so any time still ahead today is "in 1d". The web
    // does the same; parity matters more than fixing it on one side only.
    let s = status(TestData.card(nextPaymentDueDate: "2026-09-26T14:30:00Z"), now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment due Sep 26, 2026 · in 1d", tone: .soon))
  }

  @Test func zeroMinimumIsOmitted() {
    let s = status(
      TestData.card(nextPaymentDueDate: "2026-10-15T17:00:00Z", minimumPaymentAmount: 0),
      now: at(2026, 9, 26))
    #expect(s?.text == "Payment due Oct 15, 2026 · in 20d")
  }

  @Test func plaidOverdueFlagWinsOverTheDate() {
    let s = status(
      TestData.card(
        nextPaymentDueDate: "2026-10-15T17:00:00Z", minimumPaymentAmount: 35,
        paymentIsOverdue: true),
      now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment overdue — was due Oct 15, 2026 · min $35.00", tone: .overdue))
  }

  @Test func pastDateNotOverdueIsProjectedForward() {
    // Plaid's date is Sep 5 (UTC day 5); today is Sep 26, so the estimate is Oct 5.
    let s = status(
      TestData.card(nextPaymentDueDate: "2026-09-05T17:00:00Z", paymentIsOverdue: false),
      now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment due Oct 5, 2026 · in 10d · est.", tone: .normal))
  }

  @Test func manualDueDayWinsAndIsNeverOverdue() {
    let s = status(
      TestData.card(
        manualDueDay: 28, nextPaymentDueDate: "2026-09-01T17:00:00Z", paymentIsOverdue: true),
      now: at(2026, 9, 26))
    #expect(s == PaymentStatus(text: "Payment due Sep 28, 2026 · in 3d · manual", tone: .soon))
  }

  @Test func manualDayAlreadyPassedRollsToNextMonth() {
    let s = status(TestData.card(manualDueDay: 10), now: at(2026, 9, 26))
    #expect(s?.text == "Payment due Oct 10, 2026 · in 15d · manual")
  }

  @Test func day31ClampsToTheEndOfAShortMonth() {
    let due = nextMonthlyOccurrence(day: 31, now: at(2026, 9, 26), calendar: calendar)
    #expect(Formatters.date(due, calendar: calendar) == "Sep 30, 2026")
  }

  @Test func decemberRollsIntoJanuary() {
    let due = nextMonthlyOccurrence(day: 5, now: at(2026, 12, 20), calendar: calendar)
    #expect(Formatters.date(due, calendar: calendar) == "Jan 5, 2027")
  }

  @Test func daysUntilRoundsUpLikeTheWeb() {
    let now = at(2026, 9, 26)
    #expect(daysUntil(now.addingTimeInterval(3600), now: now) == 1)
    #expect(daysUntil(now.addingTimeInterval(-3600), now: now) == 0)
    #expect(daysUntil(now.addingTimeInterval(-86_400 - 1), now: now) == -1)
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: build fails — `type 'PaymentStatus' has no member 'of'` / `cannot find 'PaymentStatus' in scope`.

- [ ] **Step 3: Implement**

`ios/BudgetPhone/Accounts/PaymentStatus.swift`:

```swift
import Foundation

/// The due-date line under a credit card. A port of `paymentStatus` in
/// src/components/AccountCard.tsx, with `daysUntil` and
/// `nextMonthlyOccurrence` from src/lib/format.ts — kept identical, quirks
/// included, so the phone never disagrees with the browser about a due date.
/// `now` and `calendar` are parameters so tests can pin both.
struct PaymentStatus: Equatable, Sendable {
  enum Tone: Equatable, Sendable {
    case normal
    case soon  // due within 7 days
    case overdue
  }

  let text: String
  let tone: Tone

  static func of(
    _ account: AccountDTO,
    now: Date = .now,
    calendar: Calendar = .current
  ) -> PaymentStatus? {
    guard account.isCredit else { return nil }

    func rel(_ days: Int) -> String { days == 0 ? "today" : "in \(days)d" }
    func tone(_ days: Int) -> Tone { days <= 7 ? .soon : .normal }
    func date(_ d: Date) -> String { Formatters.date(d, calendar: calendar) }

    // Manual override wins — for issuers that don't share a due date through
    // Plaid. Always a future recurring date, so never "overdue".
    if let day = account.manualDueDay {
      let due = nextMonthlyOccurrence(day: day, now: now, calendar: calendar)
      let days = daysUntil(due, now: now)
      return PaymentStatus(
        text: "Payment due \(date(due)) · \(rel(days)) · manual",
        tone: tone(days))
    }

    guard let iso = account.nextPaymentDueDate,
      let due = Formatters.parseISO(iso)
    else { return nil }

    let min: String
    if let m = account.minimumPaymentAmount, m > 0 {
      min = " · min \(Formatters.currency(m))"
    } else {
      min = ""
    }

    // Plaid's is_overdue is authoritative — don't infer it from the date.
    if account.paymentIsOverdue == true {
      return PaymentStatus(
        text: "Payment overdue — was due \(date(due))\(min)", tone: .overdue)
    }

    let days = daysUntil(due, now: now)
    if days >= 0 {
      return PaymentStatus(
        text: "Payment due \(date(due)) · \(rel(days))\(min)", tone: tone(days))
    }

    // Plaid's date has passed but the card isn't overdue: the next statement
    // hasn't been issued yet. Project the due day forward as an estimate.
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = .gmt
    let projected = nextMonthlyOccurrence(
      day: utc.component(.day, from: due), now: now, calendar: calendar)
    let pdays = daysUntil(projected, now: now)
    return PaymentStatus(
      text: "Payment due \(date(projected)) · \(rel(pdays)) · est.",
      tone: tone(pdays))
  }
}

/// Whole days until `date`, rounded up (negative = past). format.ts daysUntil.
func daysUntil(_ date: Date, now: Date) -> Int {
  Int((date.timeIntervalSince(now) / 86_400).rounded(.up))
}

/// The next time `day` falls, today included, at local noon. Clamped to the
/// month's length, so 31 means the last day in a 30-day month.
/// format.ts nextMonthlyOccurrence.
func nextMonthlyOccurrence(day: Int, now: Date, calendar: Calendar) -> Date {
  func lastDay(_ year: Int, _ month: Int) -> Int {
    let first = calendar.date(from: DateComponents(year: year, month: month, day: 1))!
    return calendar.range(of: .day, in: .month, for: first)!.count
  }
  let today = calendar.dateComponents([.year, .month, .day], from: now)
  var year = today.year!
  var month = today.month!
  if today.day! > Swift.min(day, lastDay(year, month)) {
    month += 1
    if month > 12 {
      month = 1
      year += 1
    }
  }
  return calendar.date(
    from: DateComponents(
      year: year, month: month, day: Swift.min(day, lastDay(year, month)), hour: 12))!
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: exit 0, all `PaymentStatusTests` pass.

- [ ] **Step 5: Commit**

```bash
git add ios
git commit -m "Port the credit-card payment status line to Swift

Same branches and wording as AccountCard.tsx, including the round-up in
daysUntil, pinned by tests on a fixed calendar and clock.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Partial account patches

**Files:**
- Create: `ios/BudgetPhone/Models/AccountPatch.swift`
- Test: `ios/BudgetPhoneTests/AccountPatchTests.swift`

**Interfaces:**
- Consumes: `AccountDTO`, `Formatters.plainNumber`, `TestData`.
- Produces:
  - `enum PatchValue<Value> { case unchanged, set(Value), clear }`
  - `struct AccountPatch: Encodable, Equatable { var displayName: PatchValue<String>; var manualDueDay: PatchValue<Int>; var manualCreditLimit: PatchValue<Double>; var isEmpty: Bool }` — memberwise init with all three defaulting to `.unchanged`, so `AccountPatch(manualCreditLimit: .set(6000))` works.
  - `struct AccountEditForm { var name: String; var dueDay: Int?; var creditLimitText: String; init(account:); var creditLimit: LimitInput; var isValid: Bool; func patch(against: AccountDTO) -> AccountPatch }` with `enum LimitInput { case empty, value(Double), invalid }`.

Why this exists: the web form sends all three fields on every save. With a second client editing the same server, that silently reverts whatever the other client changed. `PATCH /api/accounts/:id` (`src/app/api/accounts/[id]/route.ts`) already applies only the keys present, so sending only what changed is enough — no server change.

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/AccountPatchTests.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

struct AccountPatchTests {
  func json(_ patch: AccountPatch) throws -> [String: Any] {
    let data = try JSONEncoder().encode(patch)
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  }

  @Test func unchangedKeysAreOmittedClearedAreNullSetArePresent() throws {
    var patch = AccountPatch()
    patch.displayName = .set("Groceries")
    patch.manualDueDay = .clear
    let body = try json(patch)
    #expect(body["displayName"] as? String == "Groceries")
    #expect(body["manualDueDay"] is NSNull)
    #expect(body.keys.contains("manualCreditLimit") == false)
  }

  @Test func anUntouchedFormProducesAnEmptyPatch() throws {
    let card = try TestData.accounts().groups[1].accounts[0]
    let patch = AccountEditForm(account: card).patch(against: card)
    #expect(patch.isEmpty)
    #expect(try json(patch).isEmpty)
  }

  @Test func onlyTheEditedFieldIsSent() throws {
    let card = try TestData.accounts().groups[1].accounts[0]
    var form = AccountEditForm(account: card)
    form.creditLimitText = "6000"
    #expect(form.patch(against: card) == AccountPatch(manualCreditLimit: .set(6000)))
  }

  @Test func blankingANameClearsIt() throws {
    let card = try TestData.accounts().groups[1].accounts[0]
    var form = AccountEditForm(account: card)
    form.name = "   "
    #expect(form.patch(against: card) == AccountPatch(displayName: .clear))
  }

  @Test func nameIsTrimmedAndAnUnchangedTrimIsNoChange() throws {
    let card = try TestData.accounts().groups[1].accounts[0]
    var form = AccountEditForm(account: card)
    form.name = "  Groceries card "
    #expect(form.patch(against: card).isEmpty)
  }

  @Test func dueDayAndLimitClear() throws {
    let card = TestData.card(manualDueDay: 6, manualCreditLimit: 5000)
    var form = AccountEditForm(account: card)
    form.dueDay = nil
    form.creditLimitText = ""
    #expect(form.patch(against: card) == AccountPatch(manualDueDay: .clear, manualCreditLimit: .clear))
  }

  @Test func nonCreditAccountsOnlyEverPatchTheName() throws {
    let checking = try TestData.accounts().groups[0].accounts[0]
    var form = AccountEditForm(account: checking)
    form.dueDay = 5
    form.creditLimitText = "100"
    #expect(form.patch(against: checking).isEmpty)
  }

  @Test func creditLimitValidation() throws {
    var form = AccountEditForm(account: TestData.card())
    form.creditLimitText = "abc"
    #expect(form.creditLimit == .invalid)
    #expect(form.isValid == false)
    form.creditLimitText = "-5"
    #expect(form.creditLimit == .invalid)
    form.creditLimitText = "2500.75"
    #expect(form.creditLimit == .value(2500.75))
    form.creditLimitText = ""
    #expect(form.creditLimit == .empty)
    #expect(form.isValid)
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: build fails — `cannot find type 'AccountPatch' in scope`.

- [ ] **Step 3: Implement**

`ios/BudgetPhone/Models/AccountPatch.swift`:

```swift
import Foundation

/// One field of a PATCH body. `.unchanged` leaves the key out entirely, so the
/// server keeps whatever it has — which may be an edit another device made
/// since this one loaded. `.clear` sends null.
enum PatchValue<Value: Encodable & Equatable & Sendable>: Equatable, Sendable {
  case unchanged
  case set(Value)
  case clear
}

/// Body for PATCH /api/accounts/:id. The route applies only the keys present
/// (`"displayName" in body`), so a patch carrying just the edited fields
/// cannot overwrite a field it did not touch.
struct AccountPatch: Encodable, Equatable, Sendable {
  var displayName: PatchValue<String> = .unchanged
  var manualDueDay: PatchValue<Int> = .unchanged
  var manualCreditLimit: PatchValue<Double> = .unchanged

  var isEmpty: Bool {
    displayName == .unchanged && manualDueDay == .unchanged
      && manualCreditLimit == .unchanged
  }

  private enum CodingKeys: String, CodingKey {
    case displayName, manualDueDay, manualCreditLimit
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try Self.encode(displayName, .displayName, into: &c)
    try Self.encode(manualDueDay, .manualDueDay, into: &c)
    try Self.encode(manualCreditLimit, .manualCreditLimit, into: &c)
  }

  private static func encode<V>(
    _ value: PatchValue<V>,
    _ key: CodingKeys,
    into c: inout KeyedEncodingContainer<CodingKeys>
  ) throws {
    switch value {
    case .unchanged: break
    case .set(let v): try c.encode(v, forKey: key)
    case .clear: try c.encodeNil(forKey: key)
    }
  }
}

/// The edit form's state, kept apart from the view so the diff and the
/// validation can be tested without SwiftUI.
struct AccountEditForm: Equatable {
  var name: String
  var dueDay: Int?
  var creditLimitText: String

  init(account: AccountDTO) {
    name = account.displayName ?? ""
    dueDay = account.manualDueDay
    creditLimitText = account.manualCreditLimit.map(Formatters.plainNumber) ?? ""
  }

  enum LimitInput: Equatable {
    case empty
    case value(Double)
    case invalid
  }

  var creditLimit: LimitInput {
    let t = creditLimitText.trimmingCharacters(in: .whitespaces)
    if t.isEmpty { return .empty }
    guard let v = Double(t), v.isFinite, v >= 0 else { return .invalid }
    return .value(v)
  }

  var isValid: Bool { creditLimit != .invalid }

  /// Only what differs from `account`. Due day and limit are compared only
  /// for credit accounts, the only ones whose form shows them.
  func patch(against account: AccountDTO) -> AccountPatch {
    var patch = AccountPatch()

    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let newName: String? = trimmed.isEmpty ? nil : trimmed
    if newName != account.displayName {
      patch.displayName = newName.map(PatchValue.set) ?? .clear
    }

    guard account.isCredit else { return patch }

    if dueDay != account.manualDueDay {
      patch.manualDueDay = dueDay.map(PatchValue.set) ?? .clear
    }

    let newLimit: Double?
    switch creditLimit {
    case .empty: newLimit = nil
    case .value(let v): newLimit = v
    case .invalid: return patch  // Save is disabled; never send a bad limit.
    }
    if newLimit != account.manualCreditLimit {
      patch.manualCreditLimit = newLimit.map(PatchValue.set) ?? .clear
    }
    return patch
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: exit 0, all `AccountPatchTests` pass.

- [ ] **Step 5: Commit**

```bash
git add ios
git commit -m "Send only the edited account fields from the iPhone app

A three-state patch value keeps untouched keys out of the PATCH body, so
an edit from the phone cannot revert one made on another device.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Server address, API client and store

**Files:**
- Create: `ios/BudgetPhone/Networking/ServerAddress.swift`, `ios/BudgetPhone/Networking/APIClient.swift`, `ios/BudgetPhone/Accounts/AccountsStore.swift`
- Test: `ios/BudgetPhoneTests/ServerAddressTests.swift`, `ios/BudgetPhoneTests/NetworkTests.swift`

**Interfaces:**
- Consumes: models, `AccountPatch`, `StubURLProtocol`, `TestData`.
- Produces:
  - `enum ServerAddress { static let storageKey = "serverURL"; static func normalize(_: String) -> URL?; static func saved(in: UserDefaults = .standard) -> URL? }`
  - `enum APIError: Error, Equatable { case notConfigured, unreachable(String), server(status: Int, message: String), decoding(String); var message: String }`
  - `struct APIClient: Sendable { let baseURL: URL; var session: URLSession = .shared; func accounts() async throws(APIError) -> AccountsResponse; func refreshBalances() async throws(APIError) -> RefreshResult; func updateAccount(id: String, patch: AccountPatch) async throws(APIError) }`
  - `@MainActor @Observable final class AccountsStore { init(client: @escaping @MainActor () -> APIClient?); private(set) var data: AccountsResponse?; private(set) var error: APIError?; private(set) var isLoading: Bool; var banner: String?; func load() async; func refresh() async; func save(_: AccountPatch, to: AccountDTO) async throws(APIError) }`

Endpoints, all existing: `GET /api/accounts`, `POST /api/plaid/refresh-balances` with body `{}` (returns `{ updated, liabilities, errors }`; 404 `{ error }` when no bank is linked), `PATCH /api/accounts/:id`. Error bodies are `{ "error": "…" }`.

Store rules (spec, "States"): with no data on screen a failure sets `error` (full-screen); with data showing it sets `banner` and keeps `data`. `refresh()` names failed banks in `banner` and reloads regardless. `save` skips an empty patch, and reloads after a successful one.

Typed throws: inside `Task { }` closures write `do throws(APIError) { … }`, or Swift infers `any Error` for the catch.

- [ ] **Step 1: Write the failing tests**

`ios/BudgetPhoneTests/ServerAddressTests.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

struct ServerAddressTests {
  @Test(arguments: [
    ("http://budget-mac.local:3000", "http://budget-mac.local:3000"),
    ("  http://100.64.0.1:3000/ ", "http://100.64.0.1:3000"),
    ("https://budget.example.ts.net//", "https://budget.example.ts.net"),
  ])
  func accepts(_ input: String, _ expected: String) {
    #expect(ServerAddress.normalize(input)?.absoluteString == expected)
  }

  @Test(arguments: ["", "   ", "budget-mac.local:3000", "ftp://budget-mac.local", "http://"])
  func rejects(_ input: String) {
    #expect(ServerAddress.normalize(input) == nil)
  }

  @Test func readsTheSavedValue() throws {
    let defaults = try #require(UserDefaults(suiteName: "ServerAddressTests"))
    defaults.removePersistentDomain(forName: "ServerAddressTests")
    #expect(ServerAddress.saved(in: defaults) == nil)
    defaults.set("http://budget-mac.local:3000/", forKey: ServerAddress.storageKey)
    #expect(ServerAddress.saved(in: defaults)?.absoluteString == "http://budget-mac.local:3000")
  }
}
```

`ios/BudgetPhoneTests/NetworkTests.swift`:

```swift
import Foundation
import Testing
@testable import BudgetPhone

/// APIClient and AccountsStore against StubURLProtocol. Serialized because
/// the stub's handler is shared state.
@Suite(.serialized)
@MainActor
struct NetworkTests {
  let base = URL(string: "http://budget-mac.local:3000")!

  func client(_ handler: @escaping (URLRequest) throws -> (Int, Data)) -> APIClient {
    APIClient(baseURL: base, session: StubURLProtocol.session(handler))
  }

  @Test func accountsHitsTheRightURLAndDecodes() async throws {
    let json = try TestData.accountsJSON()
    let response = try await client { _ in (200, json) }.accounts()
    #expect(response.summary.accountCount == 2)
    let request = try #require(StubURLProtocol.requests.first)
    #expect(request.httpMethod == "GET")
    #expect(request.url?.absoluteString == "http://budget-mac.local:3000/api/accounts")
  }

  @Test func updateSendsOnlyThePatchKeys() async throws {
    try await client { _ in (200, Data(#"{"ok":true}"#.utf8)) }
      .updateAccount(id: "acc-card", patch: AccountPatch(manualCreditLimit: .set(6000)))
    let request = try #require(StubURLProtocol.requests.first)
    #expect(request.httpMethod == "PATCH")
    #expect(request.url?.path() == "/api/accounts/acc-card")
    let body = try #require(StubURLProtocol.body(of: request))
    #expect(String(decoding: body, as: UTF8.self) == #"{"manualCreditLimit":6000}"#)
  }

  @Test func serverErrorCarriesTheRoutesMessage() async {
    let c = client { _ in (400, Data(#"{"error":"manualDueDay must be a whole number from 1 to 31"}"#.utf8)) }
    await #expect(throws: APIError.server(status: 400, message: "manualDueDay must be a whole number from 1 to 31")) {
      try await c.updateAccount(id: "x", patch: AccountPatch(manualDueDay: .set(40)))
    }
  }

  @Test func connectionFailureIsUnreachable() async {
    let c = client { _ in throw URLError(.cannotConnectToHost) }
    do {
      _ = try await c.accounts()
      Issue.record("expected a throw")
    } catch {
      guard case .unreachable = error else {
        Issue.record("expected .unreachable, got \(error)")
        return
      }
    }
  }

  @Test func wrongShapeIsDecoding() async {
    let c = client { _ in (200, Data(#"{"nope":1}"#.utf8)) }
    do {
      _ = try await c.accounts()
      Issue.record("expected a throw")
    } catch {
      guard case .decoding = error else {
        Issue.record("expected .decoding, got \(error)")
        return
      }
    }
  }

  @Test func storeWithoutAServerIsNotConfigured() async {
    let store = AccountsStore { nil }
    await store.load()
    #expect(store.error == .notConfigured)
    #expect(store.data == nil)
  }

  @Test func firstLoadFailureIsFullScreenLaterFailureIsABanner() async throws {
    let json = try TestData.accountsJSON()
    var fail = true
    let c = client { _ in
      if fail { throw URLError(.cannotConnectToHost) }
      return (200, json)
    }
    let store = AccountsStore { c }

    await store.load()
    #expect(store.data == nil)
    #expect(store.error != nil)

    fail = false
    await store.load()
    #expect(store.data != nil)
    #expect(store.error == nil)

    fail = true
    await store.load()
    #expect(store.data != nil, "a failed reload keeps what is on screen")
    #expect(store.error == nil)
    #expect(store.banner != nil)
  }

  @Test func refreshNamesFailedBanksAndStillReloads() async throws {
    let json = try TestData.accountsJSON()
    let refresh = #"{"updated":[],"liabilities":[],"errors":[{"itemId":"i1","institution":"Example Bank","error":"ITEM_LOGIN_REQUIRED"}]}"#
    let c = client { request in
      request.httpMethod == "POST" ? (200, Data(refresh.utf8)) : (200, json)
    }
    let store = AccountsStore { c }
    await store.refresh()
    #expect(store.banner == "Couldn't refresh Example Bank (ITEM_LOGIN_REQUIRED)")
    #expect(store.data?.summary.accountCount == 2)
    #expect(StubURLProtocol.requests.map(\.httpMethod) == ["POST", "GET"])
  }

  @Test func saveSkipsAnEmptyPatchAndReloadsAfterARealOne() async throws {
    let json = try TestData.accountsJSON()
    let c = client { request in
      request.httpMethod == "PATCH" ? (200, Data(#"{"ok":true}"#.utf8)) : (200, json)
    }
    let store = AccountsStore { c }
    let card = try TestData.accounts().groups[1].accounts[0]

    try await store.save(AccountPatch(), to: card)
    #expect(StubURLProtocol.requests.isEmpty)

    try await store.save(AccountPatch(displayName: .set("Travel")), to: card)
    #expect(StubURLProtocol.requests.map(\.httpMethod) == ["PATCH", "GET"])
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: build fails — `cannot find 'ServerAddress' in scope`, `cannot find 'APIClient' in scope`.

- [ ] **Step 3: Implement**

`ios/BudgetPhone/Networking/ServerAddress.swift`:

```swift
import Foundation

/// The Budget server's base URL, as typed by the user and saved on the phone.
/// Never compiled in: the server moves (this Mac today, an always-on laptop
/// later, a Tailscale address away from home) and the repo is public.
enum ServerAddress {
  static let storageKey = "serverURL"

  /// Trims whitespace and trailing slashes; nil unless it is an http(s) URL
  /// with a host.
  static func normalize(_ input: String) -> URL? {
    var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
    while s.hasSuffix("/") { s.removeLast() }
    guard let url = URL(string: s),
      let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
      let host = url.host(), !host.isEmpty
    else { return nil }
    return url
  }

  /// The saved server, if any.
  static func saved(in defaults: UserDefaults = .standard) -> URL? {
    defaults.string(forKey: storageKey).flatMap(normalize)
  }
}
```

`ios/BudgetPhone/Networking/APIClient.swift`:

```swift
import Foundation

enum APIError: Error, Equatable, Sendable {
  /// No server address saved yet.
  case notConfigured
  /// The request never got an HTTP answer: wrong address, Mac asleep, off
  /// the home network.
  case unreachable(String)
  /// A non-2xx answer. `message` is the route's `{ error }` when it sent one.
  case server(status: Int, message: String)
  /// A 2xx answer whose body didn't match the models.
  case decoding(String)

  var message: String {
    switch self {
    case .notConfigured: "No server is set."
    case .unreachable(let m): m
    case .server(_, let m): m
    case .decoding(let m): "Unexpected response from the server. \(m)"
    }
  }
}

/// The three calls the Accounts screen needs, against the web app's own API.
struct APIClient: Sendable {
  let baseURL: URL
  var session: URLSession = .shared

  func accounts() async throws(APIError) -> AccountsResponse {
    try decode(await send("GET", "api/accounts", timeout: 15))
  }

  /// Calls Plaid once per linked bank, hence the long timeout. A bank that
  /// fails comes back in `errors`; the call itself still succeeds.
  func refreshBalances() async throws(APIError) -> RefreshResult {
    try decode(await send("POST", "api/plaid/refresh-balances", body: Data("{}".utf8), timeout: 60))
  }

  func updateAccount(id: String, patch: AccountPatch) async throws(APIError) {
    let body: Data
    do { body = try JSONEncoder().encode(patch) } catch {
      throw .decoding(error.localizedDescription)
    }
    _ = try await send("PATCH", "api/accounts/\(id)", body: body, timeout: 15)
  }

  private struct ErrorBody: Decodable { let error: String }

  private func send(
    _ method: String, _ path: String, body: Data? = nil, timeout: TimeInterval
  ) async throws(APIError) -> Data {
    var request = URLRequest(url: baseURL.appending(path: path), timeoutInterval: timeout)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let body {
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw .unreachable(error.localizedDescription)
    }

    guard let http = response as? HTTPURLResponse else {
      throw .unreachable("No HTTP response.")
    }
    guard (200..<300).contains(http.statusCode) else {
      let message =
        (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
        ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
      throw .server(status: http.statusCode, message: message)
    }
    return data
  }

  private func decode<T: Decodable>(_ data: Data) throws(APIError) -> T {
    do { return try JSONDecoder().decode(T.self, from: data) } catch {
      throw .decoding(String(describing: error))
    }
  }
}
```

`ios/BudgetPhone/Accounts/AccountsStore.swift`:

```swift
import Foundation
import Observation

/// What the Accounts screen shows. Loads, refreshes and saves through
/// `APIClient`, and decides how a failure is surfaced: with nothing on
/// screen it becomes the full-screen error; with data already showing it
/// becomes a banner and the data stays.
@MainActor
@Observable
final class AccountsStore {
  private(set) var data: AccountsResponse?
  /// Set only while there is no data to show.
  private(set) var error: APIError?
  private(set) var isLoading = false
  /// A non-blocking message over data that is still valid.
  var banner: String?

  /// Resolves the client at call time, so a server changed in Settings takes
  /// effect on the next load.
  private let client: @MainActor () -> APIClient?

  init(client: @escaping @MainActor () -> APIClient?) {
    self.client = client
  }

  func load() async {
    guard let client = client() else {
      data = nil
      error = .notConfigured
      return
    }
    isLoading = true
    defer { isLoading = false }
    do {
      data = try await client.accounts()
      error = nil
    } catch {
      if data == nil {
        self.error = error
      } else {
        banner = error.message
      }
    }
  }

  /// Live balances from Plaid, then a reload. Banks that failed are named in
  /// the banner; the reload happens regardless.
  func refresh() async {
    guard let client = client() else {
      error = .notConfigured
      return
    }
    do {
      let result = try await client.refreshBalances()
      if !result.errors.isEmpty {
        banner =
          "Couldn't refresh "
          + result.errors.map { "\($0.institution) (\($0.error))" }
          .joined(separator: ", ")
      }
    } catch {
      banner = error.message
    }
    await load()
  }

  /// Sends only the changed fields, then reloads. Throws so the edit form
  /// can keep the user's input and show the message.
  func save(_ patch: AccountPatch, to account: AccountDTO) async throws(APIError) {
    guard !patch.isEmpty else { return }
    guard let client = client() else { throw .notConfigured }
    try await client.updateAccount(id: account.id, patch: patch)
    await load()
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: exit 0, every suite passes (47 tests in total at this point, counting each parameterized case).

- [ ] **Step 5: Commit**

```bash
git add ios
git commit -m "Add the iPhone app's API client and accounts store

Three calls against the existing API, typed errors, and a store that keeps
data on screen when a reload fails. Tested through a stub URL protocol.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Screens

**Files:**
- Modify: `ios/BudgetPhone/App/BudgetPhoneApp.swift` (replace the placeholder)
- Create: `ios/BudgetPhone/App/RootView.swift`
- Create: `ios/BudgetPhone/Accounts/AccountsView.swift`, `ios/BudgetPhone/Accounts/NetWorthHeader.swift`, `ios/BudgetPhone/Accounts/AccountRow.swift`, `ios/BudgetPhone/Accounts/AccountEditView.swift`
- Create: `ios/BudgetPhone/Settings/ServerForm.swift`, `ios/BudgetPhone/Settings/ServerSetupView.swift`, `ios/BudgetPhone/Settings/SettingsView.swift`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: the app. `AccountDTO` gains `Hashable` (by `id`) in `AccountsView.swift` for `NavigationLink(value:)`.

Views stay thin: all logic they need is already tested. Standard components only — `TabView` with `Tab`, `NavigationStack`, `.insetGrouped` `List`, `Form`, `ContentUnavailableView`, `.refreshable`. No custom colours beyond the tone mapping (`.secondary`, `.orange`, `.red`) and the net-worth green/red, which match the web.

- [ ] **Step 1: Write the views**

`ios/BudgetPhone/App/BudgetPhoneApp.swift`:

```swift
import SwiftUI

@main
struct BudgetPhoneApp: App {
  var body: some Scene {
    WindowGroup {
      RootView()
    }
  }
}
```

`ios/BudgetPhone/App/RootView.swift`:

```swift
import SwiftUI

/// First launch asks for the server; after that, the tabs.
struct RootView: View {
  @AppStorage(ServerAddress.storageKey) private var server = ""

  var body: some View {
    if ServerAddress.normalize(server) == nil {
      ServerSetupView()
    } else {
      TabView {
        Tab("Accounts", systemImage: "building.columns") {
          AccountsView()
        }
        Tab("Settings", systemImage: "gear") {
          SettingsView()
        }
      }
    }
  }
}
```

`ios/BudgetPhone/Accounts/AccountsView.swift`:

```swift
import SwiftUI

struct AccountsView: View {
  @Environment(\.scenePhase) private var scenePhase
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var store = AccountsStore {
    ServerAddress.saved().map { APIClient(baseURL: $0) }
  }

  var body: some View {
    NavigationStack {
      content
        .navigationTitle("Accounts")
        .navigationDestination(for: AccountDTO.self) { account in
          AccountEditView(account: account, store: store)
        }
    }
    .task { await store.load() }
    // Another device may have changed something while this one was away.
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { Task { await store.load() } }
    }
    .onChange(of: server) { Task { await store.load() } }
  }

  @ViewBuilder private var content: some View {
    if let data = store.data {
      if data.summary.accountCount == 0 {
        ContentUnavailableView(
          "No Accounts", systemImage: "building.columns",
          description: Text("Connect a bank from Budget on your Mac."))
      } else {
        list(data)
      }
    } else if let error = store.error {
      ErrorView(error: error, server: server) { Task { await store.load() } }
    } else {
      ProgressView()
    }
  }

  private func list(_ data: AccountsResponse) -> some View {
    List {
      Section {
        NetWorthHeader(summary: data.summary)
      }
      ForEach(data.groups) { group in
        Section {
          ForEach(group.accounts) { account in
            NavigationLink(value: account) {
              AccountRow(account: account)
            }
          }
        } header: {
          HStack {
            Text(group.label)
            Spacer()
            Text(Formatters.currency(group.signedSubtotal)).monospacedDigit()
          }
        }
      }
      if let refreshed = data.summary.lastRefreshed.flatMap(Formatters.parseISO) {
        Section {
        } footer: {
          UpdatedFooter(date: refreshed)
        }
      }
    }
    .listStyle(.insetGrouped)
    .refreshable { await store.refresh() }
    .safeAreaInset(edge: .top) {
      if let banner = store.banner {
        Banner(text: banner) { store.banner = nil }
      }
    }
  }
}

extension AccountDTO: Hashable {
  func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// "Balances updated 5m ago", orange once older than an hour — the web's
/// STALE_THRESHOLD_MIN.
private struct UpdatedFooter: View {
  let date: Date

  var body: some View {
    TimelineView(.periodic(from: .now, by: 60)) { context in
      let stale = context.date.timeIntervalSince(date) > 60 * 60
      Text("Balances updated \(Formatters.relative(date, now: context.date))")
        .foregroundStyle(stale ? .orange : .secondary)
        .frame(maxWidth: .infinity)
    }
  }
}

private struct Banner: View {
  let text: String
  let dismiss: () -> Void

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
      Text(text).font(.footnote).frame(maxWidth: .infinity, alignment: .leading)
      Button("Dismiss", systemImage: "xmark", action: dismiss)
        .labelStyle(.iconOnly)
        .foregroundStyle(.secondary)
    }
    .padding(12)
    .background(.regularMaterial, in: .rect(cornerRadius: 12))
    .padding(.horizontal)
  }
}

struct ErrorView: View {
  let error: APIError
  let server: String
  let retry: () -> Void

  var body: some View {
    switch error {
    case .notConfigured, .unreachable:
      ContentUnavailableView {
        Label("Can't Reach Budget", systemImage: "wifi.exclamationmark")
      } description: {
        Text("Make sure the Mac is awake, Budget is running, and this iPhone is on the same network.\n\n\(server)")
      } actions: {
        Button("Retry", action: retry).buttonStyle(.borderedProminent)
      }
    case .server, .decoding:
      ContentUnavailableView {
        Label("Something Went Wrong", systemImage: "exclamationmark.triangle")
      } description: {
        Text(error.message)
      } actions: {
        Button("Retry", action: retry).buttonStyle(.borderedProminent)
      }
    }
  }
}
```

`ios/BudgetPhone/Accounts/NetWorthHeader.swift`:

```swift
import SwiftUI

struct NetWorthHeader: View {
  let summary: AccountsSummary

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Net Worth")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      Text(Formatters.currency(summary.netWorth))
        .font(.largeTitle.weight(.semibold))
        .monospacedDigit()
        .minimumScaleFactor(0.6)
        .lineLimit(1)
      HStack(spacing: 16) {
        figure("Assets", summary.totalAssets, .green)
        figure("Liabilities", summary.totalLiabilities, .red)
      }
      .font(.subheadline)
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }

  private func figure(_ label: String, _ amount: Double, _ color: Color) -> some View {
    HStack(spacing: 4) {
      Text(label).foregroundStyle(.secondary)
      Text(Formatters.currency(amount)).foregroundStyle(color).monospacedDigit()
    }
  }
}
```

`ios/BudgetPhone/Accounts/AccountRow.swift`:

```swift
import SwiftUI

struct AccountRow: View {
  let account: AccountDTO

  var body: some View {
    let status = PaymentStatus.of(account)
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text(account.title).lineLimit(1)
        Text(account.subtitle)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .lineLimit(1)
        if let status {
          Text(status.text)
            .font(.footnote.weight(status.tone == .normal ? .regular : .medium))
            .foregroundStyle(status.tone.color)
        }
      }
      Spacer(minLength: 0)
      VStack(alignment: .trailing, spacing: 2) {
        Text(Formatters.currency(account.signedBalance)).monospacedDigit()
        if let available = account.availableWorthShowing {
          Text("\(account.availableLabel) \(Formatters.currency(available))")
            .font(.caption)
            .foregroundStyle(.secondary)
            .monospacedDigit()
        }
      }
    }
    .accessibilityElement(children: .combine)
  }
}

extension PaymentStatus.Tone {
  var color: Color {
    switch self {
    case .normal: .secondary
    case .soon: .orange
    case .overdue: .red
    }
  }
}
```

`ios/BudgetPhone/Accounts/AccountEditView.swift`:

```swift
import SwiftUI

struct AccountEditView: View {
  let account: AccountDTO
  let store: AccountsStore

  @Environment(\.dismiss) private var dismiss
  @State private var form: AccountEditForm
  @State private var saving = false
  @State private var saveError: String?

  init(account: AccountDTO, store: AccountsStore) {
    self.account = account
    self.store = store
    _form = State(initialValue: AccountEditForm(account: account))
  }

  private var patch: AccountPatch { form.patch(against: account) }

  var body: some View {
    Form {
      Section {
        TextField(account.name, text: $form.name)
          .textInputAutocapitalization(.words)
      } header: {
        Text("Name")
      } footer: {
        Text("Leave empty to use the bank's name.")
      }

      if account.isCredit {
        Section {
          Picker("Due Day", selection: $form.dueDay) {
            Text("None").tag(Int?.none)
            ForEach(1...31, id: \.self) { day in
              Text("\(day)").tag(Int?.some(day))
            }
          }
          LabeledContent("Credit Limit") {
            TextField("None", text: $form.creditLimitText)
              .keyboardType(.decimalPad)
              .multilineTextAlignment(.trailing)
              .foregroundStyle(form.isValid ? Color.primary : Color.red)
          }
        } header: {
          Text("Card")
        } footer: {
          Text("For cards whose bank doesn't share a due date or limit through Plaid.")
        }
      }

      Section {
        LabeledContent("Bank", value: account.institution)
        if let mask = account.mask { LabeledContent("Number", value: "··\(mask)") }
        LabeledContent("Balance", value: Formatters.currency(account.signedBalance))
      }
    }
    .navigationTitle(account.title)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        if saving {
          ProgressView()
        } else {
          Button("Save", action: save)
            .disabled(patch.isEmpty || !form.isValid)
        }
      }
    }
    .alert(
      "Couldn't Save",
      isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } })
    ) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(saveError ?? "")
    }
  }

  private func save() {
    saving = true
    Task {
      defer { saving = false }
      do throws(APIError) {
        try await store.save(patch, to: account)
        dismiss()
      } catch {
        saveError = error.message
      }
    }
  }
}
```

`ios/BudgetPhone/Settings/ServerForm.swift`:

```swift
import SwiftUI

/// The server field and its Test Connection button, shared by first-launch
/// setup and Settings. Saves only an address that parses.
struct ServerForm: View {
  @AppStorage(ServerAddress.storageKey) private var server = ""
  @State private var draft = ""
  @State private var testResult: Result<Int, APIError>?
  @State private var testing = false

  var body: some View {
    Section {
      TextField("http://your-mac.local:3000", text: $draft)
        .keyboardType(.URL)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .onSubmit(save)
      Button(testing ? "Testing…" : "Save and Test Connection", action: saveAndTest)
        .disabled(ServerAddress.normalize(draft) == nil || testing)
      if let testResult {
        switch testResult {
        case .success(let count):
          Label("Connected — \(count) accounts", systemImage: "checkmark.circle.fill")
            .foregroundStyle(.green)
        case .failure(let error):
          Label(error.message, systemImage: "xmark.circle.fill")
            .foregroundStyle(.red)
        }
      }
    } header: {
      Text("Server")
    } footer: {
      Text(
        "The address Budget runs at, including the port. Use the Mac's name ending in .local — it survives the router handing out a new IP. Away from home, use a Tailscale address instead."
      )
    }
    .onAppear { draft = server }
  }

  private func save() {
    if let url = ServerAddress.normalize(draft) {
      server = url.absoluteString
      draft = server
    }
  }

  private func saveAndTest() {
    guard let url = ServerAddress.normalize(draft) else { return }
    testing = true
    Task {
      defer { testing = false }
      do throws(APIError) {
        let response = try await APIClient(baseURL: url).accounts()
        testResult = .success(response.summary.accountCount)
        save()
      } catch {
        testResult = .failure(error)
      }
    }
  }
}
```

`ios/BudgetPhone/Settings/ServerSetupView.swift`:

```swift
import SwiftUI

/// Shown until a server is saved. Saving one swaps RootView over to the tabs.
struct ServerSetupView: View {
  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text("Budget on your iPhone reads and edits the same data as Budget on your Mac. Enter the address of the Mac that runs it.")
            .foregroundStyle(.secondary)
        }
        ServerForm()
      }
      .navigationTitle("Connect to Budget")
    }
  }
}
```

`ios/BudgetPhone/Settings/SettingsView.swift`:

```swift
import SwiftUI

struct SettingsView: View {
  private var version: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
  }

  var body: some View {
    NavigationStack {
      Form {
        ServerForm()
        Section("About") {
          LabeledContent("Version", value: version)
        }
      }
      .navigationTitle("Settings")
    }
  }
}
```

- [ ] **Step 2: Build and run the tests**

Run: `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: exit 0, no warnings from these files, all tests still pass.

- [ ] **Step 3: Verify in the simulator against a live server**

Budget must be running on the Mac (`lsof -nP -iTCP:3000 -sTCP:LISTEN`). The simulator shares the Mac's network, so the server is `http://localhost:3000`. The bundle id is `local.budget.BudgetPhone` unless `Local.xcconfig` overrides the prefix.

```bash
D=$(xcrun simctl list devices available | grep 'iPhone 17 Pro (' | head -1 | grep -oE '[0-9A-F-]{36}')
xcrun simctl boot "$D" 2>/dev/null; xcrun simctl bootstatus "$D" -b
xcrun simctl install "$D" build/DerivedData/Build/Products/Debug-iphonesimulator/BudgetPhone.app
xcrun simctl launch "$D" local.budget.BudgetPhone
```

Check each, with a screenshot (`xcrun simctl io "$D" screenshot <name>.png`) or the Simulator app:

1. First launch shows "Connect to Budget". Enter `http://localhost:3000`, tap **Save and Test Connection** → "Connected — N accounts", then the tabs appear.
2. Accounts: net worth, assets and liabilities match the web page `/accounts`; one section per group with its subtotal (credit cards negative); names are not truncated for typical cash accounts; "Available" appears only where it differs from the balance.
3. Credit cards show their due line in the same wording as the web card, orange within 7 days.
4. Pull to refresh completes and the footer reads "Balances updated just now".
5. Tap a card → edit its name, due day and limit → Save. The list reloads with the change, and the web page shows it after a reload.
6. Change a name on the web, background the app (⇧⌘H), reopen it → the change appears.
7. Settings → set `http://localhost:3999` → Accounts shows "Can't Reach Budget" with the address and Retry; set it back → Retry recovers.
8. `xcrun simctl ui "$D" appearance dark` → screenshot; `xcrun simctl ui "$D" content_size accessibility-extra-extra-extra-large` → screenshot; then restore with `appearance light` and `content_size large`.

To skip typing the server during repeated runs: `xcrun simctl spawn "$D" defaults write local.budget.BudgetPhone serverURL http://localhost:3000`.

- [ ] **Step 4: Commit**

```bash
git add ios
git commit -m "Build the iPhone app's Accounts and Settings screens

Standard iOS components over the tested store: grouped accounts with
pull-to-refresh, an edit form that saves only changed fields, first-launch
server setup, and full-screen and banner error states.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: README and pre-merge checks

**Files:**
- Create: `ios/README.md`

**Interfaces:** none.

- [ ] **Step 1: Write the README**

`ios/README.md`:

````markdown
# Budget for iPhone

A native SwiftUI client for the Budget web app. It reads and edits the same
data by calling the web app's own API, so the Budget server has to be running
somewhere the phone can reach. v1 has the Accounts screen only.

Design: `../docs/superpowers/specs/2026-09-26-ios-accounts-design.md`.

## Run in the simulator

```bash
open BudgetPhone.xcodeproj
```

Pick an iPhone simulator and press Run (⌘R). On first launch, enter
`http://localhost:3000` — the simulator shares the Mac's network.

Tests: ⌘U in Xcode, or

```bash
xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData
```

## Run on your iPhone (free Apple ID)

1. `cp Config/Local.example.xcconfig Config/Local.xcconfig`
2. Xcode → Settings → Accounts → add your Apple ID. It creates a free
   "Personal Team".
3. Open the project, select the **BudgetPhone** target → Signing &
   Capabilities → Team → your Personal Team. Copy the Team ID it shows into
   `DEVELOPMENT_TEAM` in `Config/Local.xcconfig`, so it survives a clean
   checkout. If Xcode says the bundle identifier is taken, change
   `BUNDLE_ID_PREFIX` there too.
4. Connect the iPhone by cable. On the phone: Settings → Privacy & Security →
   Developer Mode → on (it restarts).
5. Choose the iPhone as the run destination and press Run. The first time,
   trust the developer on the phone: Settings → General → VPN & Device
   Management.
6. In the app, enter the Mac's address, e.g. `http://your-mac.local:3000`
   (System Settings → General → Sharing shows the `.local` name). Allow
   local-network access when iOS asks.

**Every 7 days** a free signature expires and the app stops opening. Connect
the phone and press Run again; nothing on the phone is lost.

## Away from home

The server has no login, so it is only reachable on your own network. To use
the app elsewhere, install Tailscale on the Mac and the iPhone, then put the
Mac's Tailscale address in the app's Settings. Add authentication to the
server before running it anywhere permanently — see the design doc.
````

- [ ] **Step 2: Run the web suite and the scrub check**

The iPhone app changes no web code, but the scrub check reads every tracked file, `ios/` included.

Run (from `budget-claude/`, with `node_modules` symlinked from the main checkout if this is a worktree): `npm test`
Expected: `0 failed` for scrub and launcher checks, all node tests pass, lint clean.

Run: `git grep -nI -e DEVELOPMENT_TEAM -- ios`
Expected: only the empty line in `Local.example.xcconfig` and the comment in `Shared.xcconfig`.

- [ ] **Step 3: Run the iOS tests one last time**

Run (from `ios/`): `xcodebuild test -project BudgetPhone.xcodeproj -scheme BudgetPhone -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/DerivedData -quiet`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add ios/README.md
git commit -m "Document running the iPhone app

Simulator and free-Apple-ID device steps, the 7-day re-sign, and why the
server stays on the home network until it has authentication.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Merge readiness (do not merge without the user's go-ahead)**

From the repository root, check for overlap and conflicts before proposing the merge:

```bash
git log --oneline $(git merge-base main ios-accounts)..main
git merge-tree --write-tree main ios-accounts >/dev/null && echo clean || echo CONFLICTS
```

Report the result. The merge itself (`test "$(git branch --show-current)" = main && git merge --no-ff ios-accounts -m "Merge ios-accounts: iPhone app with Accounts"`) happens only when the user says so.
