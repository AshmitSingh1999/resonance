# resonance-audio

A Swift executable that captures system audio and prints per-frame features as
NDJSON on stdout. Spawned by the daemon; never run directly in normal use.

## Why it exists

Chrome can capture system audio through `getDisplayMedia`, but the grant is
per-session — every restart means completing the screen-share picker again. Core
Audio **process taps** sit behind `NSAudioCaptureUsageDescription`, a narrower
permission that grants no access to screen contents and is remembered.

## Output

One JSON object per line on stdout; diagnostics on stderr.

```
{"type":"ready"}
{"type":"frame","bass":0.14,"mid":0.20,"treble":0.05,"rms":0.28,"centroid":0.17,
 "onset":false,"spectrum":"<base64>","waveform":"<base64>"}
{"type":"error","code":"denied","message":"..."}
```

The shape matches what the browser's own analyser produces, so the renderer
cannot tell — and does not need to know — which source a frame came from.

## Decisions worth not undoing

**The signing certificate is load-bearing, not ceremony.** macOS keys TCC
permission records to a binary's *signing identity*. An ad-hoc signature is a hash
of the binary, so every rebuild is a new identity and macOS asks again. Measured:

| Signing | Designated requirement | Survives a rebuild |
|---|---|---|
| self-signed certificate | `identifier + certificate leaf` | yes |
| ad-hoc | `cdhash H"…"` | no |

`build.sh` checks `security find-identity -p codesigning` **without** `-v`: a
self-signed certificate is always reported untrusted and so never appears among
"valid" identities, yet `codesign` uses it perfectly well.

**Features are computed here, not shipped as PCM.** Node has no FFT and streaming
raw audio over a pipe would be wasteful; Accelerate/vDSP is free here.

**Frames are emitted at 30Hz, not 60.** Onsets are detected at the full FFT hop
rate and merely *flagged* on the next frame, so transient fidelity does not depend
on the emit rate, and the consumer's smoothing makes it look continuous.

**The JSON line is built by joining parts, not one long `+` chain.** Swift's type
checker takes exponential time on long concatenations of interpolated strings.

## Looks broken but isn't

**The process appears to hang on first run with no output.** It is blocked in
`AudioDeviceStart`, which is what triggers the permission prompt. Nothing asks
before that point, by design — so silence here means a dialog is waiting.

**`build.sh` bounds `codesign` at 25 seconds.** When the signing key's access list
does not include `codesign`, macOS shows a keychain dialog and waits forever in a
non-interactive shell. The timeout exists to report the cause rather than look
like a hung compiler.

## Building

```sh
../../scripts/signing-cert.sh   # once
./build.sh
```

Requires macOS 14.2+ for process taps. The Info.plist is embedded into the binary
via `-sectcreate`, because this is a plain executable rather than an app bundle
and macOS reads `NSAudioCaptureUsageDescription` from `__TEXT,__info_plist`.
