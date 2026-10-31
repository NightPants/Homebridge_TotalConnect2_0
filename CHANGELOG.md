# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-10-31

### Added
- Full Homebridge dynamic platform (`HoyTotalConnect`) compatible with **Homebridge v1.8+ and v2.0+** and **Node.js 22 / 24**.
- Live **Total Connect 2.0** OAuth2 authentication (`TC2API.Auth/token`) with dynamic bootstrap key discovery (`application.config.json`), RSA `PKCS#1 v1.5` credential encryption, automatic refresh-token rotation, session recovery, and clean logout on shutdown.
- **HomeKit Security System** support for Vista, Lyric, Lynx, and ProA7 panels in either combined-location or per-partition mode (`Stay`, `Stay Instant`, `Night Stay`, `Away`, `Away Instant`, `Disarm`, and `Alarm Triggered` for Burglary, Fire/Smoke, and Carbon Monoxide).
- **Zone Sensors** (`Contact`, `Motion`, `Smoke`, `Carbon Monoxide`, `Leak`, `Occupancy`) with automatic Honeywell `ZoneType` classification, tamper, low-battery, supervision fault, and bypass status characteristics.
- **HomeKit Automation helpers**:
  - Confirmation-free **Arm-Only Switches** (`Arm Away`, `Arm Home`, `Arm Night`) that never disarm.
  - **Auto-bypass open zones on arm** (`autoBypassOnArm`) and **auto-bypass low-battery zones** (`autoBypassLowBattery`).
  - Momentary **Bypass Open Zones** / **Clear Bypass** switches and optional per-zone bypass switches.
  - Optional **Alarm Triggered Contact Sensor** for HomeKit light/siren/notification automations.
- **Interactive Homebridge Custom UI** (`Test Login & Discover`) to verify credentials, view live locations/partitions/zones, and assign sensor types with one click.
- Security hardening: `*.alarmnet.com` HTTPS host pinning, redirect blocking, credential lockout circuit breaker, automatic log redaction, and `TOTALCONNECT_*` environment variable support.

