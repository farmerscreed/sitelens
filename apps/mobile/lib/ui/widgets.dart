import 'package:flutter/material.dart';
import '../core/theme.dart';

// Shared visual language: glass panels, glowing icon orbs, gradient CTAs, and
// the soft radial "engine glow" behind key screens. Pure core-Flutter — no
// blur filters (cheap on low-end Androids), glows are shadows and gradients.

/// Soft radial glow orbs behind a screen's content.
class OrbBackdrop extends StatelessWidget {
  const OrbBackdrop({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(children: [
      Positioned(
        top: -120,
        right: -100,
        child: _orb(kAccent.withOpacity(0.13), 340),
      ),
      Positioned(
        bottom: -140,
        left: -120,
        child: _orb(const Color(0xFF3B5BFF).withOpacity(0.08), 380),
      ),
      child,
    ]);
  }

  Widget _orb(Color c, double size) => IgnorePointer(
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: RadialGradient(colors: [c, c.withOpacity(0)]),
          ),
        ),
      );
}

/// The standard panel: 4% white glass, hairline border, optional accent glow.
class GlassCard extends StatelessWidget {
  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.glowColor,
    this.borderColor,
    this.onTap,
  });
  final Widget child;
  final EdgeInsets padding;
  final Color? glowColor;
  final Color? borderColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final card = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: kGlass,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: borderColor ?? kBorder),
        boxShadow: glowColor != null ? glow(glowColor!) : null,
      ),
      child: child,
    );
    if (onTap == null) return card;
    return Material(
      color: Colors.transparent,
      child: InkWell(borderRadius: BorderRadius.circular(20), onTap: onTap, child: card),
    );
  }
}

/// Rounded icon tile with a soft colored glow — the app's visual signature.
class IconOrb extends StatelessWidget {
  const IconOrb(this.icon, {super.key, this.color = kAccent, this.size = 46});
  final IconData icon;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color.withOpacity(0.14),
        borderRadius: BorderRadius.circular(size * 0.32),
        border: Border.all(color: color.withOpacity(0.35)),
        boxShadow: glow(color, strength: 0.25, blur: 18),
      ),
      child: Icon(icon, color: color, size: size * 0.5),
    );
  }
}

/// Primary CTA: amber sheen gradient + glow. The one loud thing on a screen.
class GradientButton extends StatelessWidget {
  const GradientButton({super.key, required this.label, this.icon, this.onPressed, this.height = 58});
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final double height;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    return Opacity(
      opacity: enabled ? 1 : 0.38,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          gradient: kAccentSheen,
          borderRadius: BorderRadius.circular(17),
          boxShadow: enabled ? glow(kAccent, strength: 0.45, blur: 26) : null,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(17),
            onTap: onPressed,
            child: Center(
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                if (icon != null) ...[
                  Icon(icon, color: Colors.black, size: 22),
                  const SizedBox(width: 9),
                ],
                Text(label,
                    style: const TextStyle(
                        color: Colors.black, fontSize: 17, fontWeight: FontWeight.w800, letterSpacing: 0.2)),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

/// Tiny uppercase tracked label above a section.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(text.toUpperCase(),
        style: const TextStyle(color: kFaint, fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 1.6));
  }
}

/// Glowing status dot.
class StatusDot extends StatelessWidget {
  const StatusDot(this.color, {super.key, this.size = 8});
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        boxShadow: [BoxShadow(color: color.withOpacity(0.8), blurRadius: 8)],
      ),
    );
  }
}

/// The brand mark: amber orb + wordmark with a gradient sheen on "Lens".
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.compact = false});
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Container(
        width: compact ? 34 : 44,
        height: compact ? 34 : 44,
        decoration: BoxDecoration(
          gradient: kAccentSheen,
          borderRadius: BorderRadius.circular(compact ? 11 : 14),
          boxShadow: glow(kAccent, strength: 0.5, blur: 22),
        ),
        child: Icon(Icons.grid_view_rounded, color: Colors.black, size: compact ? 18 : 24),
      ),
      SizedBox(width: compact ? 10 : 14),
      ShaderMask(
        shaderCallback: (r) => const LinearGradient(colors: [kText, kAccentHi]).createShader(r),
        child: Text('SiteLens',
            style: TextStyle(
                fontSize: compact ? 19 : 30,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.5,
                color: Colors.white)),
      ),
    ]);
  }
}

/// Step progress for the report flow: filled amber segments with glow.
class StepBar extends StatelessWidget {
  const StepBar({super.key, required this.step, required this.total});
  final int step; // 0-based current
  final int total;

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      for (var i = 0; i < total; i++) ...[
        Expanded(
          child: Container(
            height: 5,
            decoration: BoxDecoration(
              gradient: i <= step ? kAccentSheen : null,
              color: i <= step ? null : kGlassHi,
              borderRadius: BorderRadius.circular(3),
              boxShadow: i == step ? glow(kAccent, strength: 0.5, blur: 10) : null,
            ),
          ),
        ),
        if (i < total - 1) const SizedBox(width: 6),
      ],
    ]);
  }
}
