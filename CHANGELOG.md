# Changelog

All notable changes to the Test Console. Versions follow
[semantic versioning](https://semver.org): **major** for a change that breaks
how the rig is driven or how results are read, **minor** for a new page,
test or capability, **patch** for fixes and polish.

New entries go under **Unreleased** as work lands; `scripts/release.ps1`
turns that heading into the version and date.

## [Unreleased]

### Added
- `scripts/publish-release.ps1` creates the GitHub Release page from the
  changelog; `release.ps1 -Push` runs it, and `-Bundle` attaches the
  DUT-only zip.

### Changed
- A disabled primary key ("Needs DUT") is the faded grey of any disabled key,
  not a blue wash that looked pressable, and no longer shows a tooltip.
- The inspector always opens on the Bench tab.

### Fixed
- Stop on the LoRa CW, Modulated and Debug pages is disabled while no DUT is
  connected, as Send is; it stayed pressable with nothing to stop.

## [1.0.0] - 2026-10-21

The first versioned release.

### Tests
- **LoRa:** CW (manual and automated sweep with tolerance verdicts),
  Modulated, Debug, Mode Sweep, and the Load Pull test with trombone sweep,
  RF switching and Smith chart.
- **LTE:** CW and Modulated, with EARFCN/MHz channel entry and band filters.
- **Components:** Trombone, RF switch, network analyzer, power meter, signal
  generator, DC analyzer and spectrum analyzer pages.

### Design (the Inspector redesign)
- macOS-style shell: full-height sidebar with foldable sections and the DC
  supply, a translucent window toolbar holding each page's title and keys,
  and a right inspector with Bench, Log and Assistant tabs.
- One blue accent; grey secondary keys; filled field wells; labelled E-Stop;
  Light, Mid and Dark themes.
- Results tables with units in brackets and PASS / FAIL counts that filter the
  rows.
- Instruments dialog as grouped panels, with Re-scan in the address field.
- Load Pull's trombone step as three cards, with a shared hold-to-jog pad
  that the Trombone page now has too.
- Settings: DUT scan time, "Select text on focus" (off by default), theme.
- Nothing changes size when its state changes.

### Docs
- DESIGN.md, the user manual and the testing guide describe this release.
  Manual screenshots still show the previous design.

[Unreleased]: https://github.com/YossiAbutbul/test-console/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/YossiAbutbul/test-console/releases/tag/v1.0.0
