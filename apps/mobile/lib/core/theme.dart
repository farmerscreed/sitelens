import 'package:flutter/material.dart';

// SiteLens field design system — the web console's dark "command" identity,
// rebuilt for a phone in sunlight: deep layered ink, glass panels, one hi-vis
// amber accent with glow, big touch targets (44px+), 16px+ text. Futuristic,
// never at the cost of legibility.

const kInk = Color(0xFF070B14);        // page background (deepest)
const kInk2 = Color(0xFF0C1322);       // raised background
const kGlass = Color(0x0AFFFFFF);      // card fill (4% white)
const kGlassHi = Color(0x14FFFFFF);    // pressed / highlighted fill
const kBorder = Color(0x14FFFFFF);     // 8% white hairline
const kAccent = Color(0xFFF5A623);     // hi-vis amber
const kAccentHi = Color(0xFFFFC24D);   // amber highlight (gradient top)
const kAccentDeep = Color(0xFFFF8A3C); // amber → orange (gradient bottom)
const kGood = Color(0xFF34D399);       // emerald
const kBad = Color(0xFFF87171);        // soft red
const kText = Color(0xFFEDF1F7);
const kMuted = Color(0xFF8B95A7);
const kFaint = Color(0xFF5B6473);

const kAccentSheen = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [kAccentHi, kAccentDeep],
);

List<BoxShadow> glow(Color c, {double strength = 0.35, double blur = 24}) => [
      BoxShadow(color: c.withOpacity(strength), blurRadius: blur, spreadRadius: -2),
    ];

ThemeData siteLensTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: kInk,
    colorScheme: base.colorScheme.copyWith(
      primary: kAccent,
      secondary: kAccent,
      surface: kInk2,
      onPrimary: Colors.black,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(color: kText, fontSize: 18, fontWeight: FontWeight.w700, letterSpacing: -0.2),
      iconTheme: IconThemeData(color: kMuted),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: kAccent,
        foregroundColor: Colors.black,
        minimumSize: const Size.fromHeight(56),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, letterSpacing: 0.2),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: kText,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: Color(0xFF232B3B)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: kGlass,
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 17),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFF232B3B)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFF232B3B)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: kAccent, width: 1.4),
      ),
      hintStyle: const TextStyle(color: kFaint),
      labelStyle: const TextStyle(color: kMuted),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: kGlass,
      selectedColor: kAccent.withOpacity(0.22),
      side: const BorderSide(color: Color(0xFF232B3B)),
      labelStyle: const TextStyle(color: kText, fontSize: 15, fontWeight: FontWeight.w600),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: kInk2,
      contentTextStyle: const TextStyle(color: kText, fontSize: 15),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14), side: const BorderSide(color: kBorder)),
    ),
    dividerTheme: const DividerThemeData(color: Color(0xFF1B2232)),
  );
}
