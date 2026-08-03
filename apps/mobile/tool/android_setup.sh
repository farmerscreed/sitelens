#!/usr/bin/env bash
# Run AFTER `flutter create --platforms=android .` (CI does this — the android/
# platform dir is generated, not committed). Patches the generated manifest with
# the permissions the field app needs and the proper app label.
set -euo pipefail
M=android/app/src/main/AndroidManifest.xml

# flutter create drops a boilerplate widget test referencing a MyApp class that
# doesn't exist here — remove it (CI runs analyze, not widget tests).
rm -f test/widget_test.dart

if ! grep -q ACCESS_FINE_LOCATION "$M"; then
  sed -i 's#<application#<uses-permission android:name="android.permission.INTERNET"/>\n    <uses-permission android:name="android.permission.CAMERA"/>\n    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>\n    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>\n    <application#' "$M"
fi
sed -i 's/android:label="[^"]*"/android:label="SiteLens"/' "$M"
echo "manifest patched:"
grep -E 'uses-permission|android:label' "$M"
