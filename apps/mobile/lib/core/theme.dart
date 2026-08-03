import 'package:flutter/material.dart';

// The console's dark "command" look, tuned for a site: high contrast, amber accent,
// big touch targets (44px+), 16px+ text — usable with dusty fingers in sunlight.
const kInk = Color(0xFF0B0F17);
const kInkCard = Color(0xFF141A26);
const kAccent = Color(0xFFF5A623);
const kMuted = Color(0xFF8B95A7);
const kGood = Color(0xFF34D399);

ThemeData siteLensTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: kInk,
    colorScheme: base.colorScheme.copyWith(
      primary: kAccent,
      secondary: kAccent,
      surface: kInkCard,
      onPrimary: Colors.black,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: kInk,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600),
    ),
    cardTheme: CardThemeData(
      color: kInkCard,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      margin: EdgeInsets.zero,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: kAccent,
        foregroundColor: Colors.black,
        minimumSize: const Size.fromHeight(56),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: Color(0xFF2A3242)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: kInkCard,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFF2A3242)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFF2A3242)),
      ),
      hintStyle: const TextStyle(color: kMuted),
      labelStyle: const TextStyle(color: kMuted),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: kInkCard,
      selectedColor: kAccent.withOpacity(0.25),
      labelStyle: const TextStyle(color: Colors.white, fontSize: 15),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: kInkCard,
      contentTextStyle: TextStyle(color: Colors.white, fontSize: 15),
      behavior: SnackBarBehavior.floating,
    ),
  );
}
