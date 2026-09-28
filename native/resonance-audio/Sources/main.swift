//
//  resonance-audio — stream system-audio features as NDJSON.
//
//  Exists so audio reactivity does not require Chrome's screen-share picker.
//  Core Audio process taps sit behind the "System Audio Recording Only" TCC
//  category, which is narrower than screen recording, grants no access to screen
//  contents, and is granted once and remembered.
//
//  Features are computed here rather than in the daemon: Node has no FFT and
//  shipping raw PCM over a pipe would be wasteful, while Accelerate is free here.
//  The emitted shape matches the browser's own analyser exactly, so nothing
//  downstream needs to know which source a frame came from.
//
//  Output: one JSON object per line on stdout. Diagnostics go to stderr.
//

import Foundation
import AudioToolbox
import CoreAudio
import Accelerate

// MARK: - Output

/// Diagnostics go to stderr so stdout stays a clean NDJSON stream.
func log(_ message: String) {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
}

/// Emit a single structured line and exit, for failures the daemon should report.
func fail(_ reason: String, code: String) -> Never {
    print("{\"type\":\"error\",\"code\":\"\(code)\",\"message\":\"\(reason)\"}")
    fflush(stdout)
    exit(1)
}

// MARK: - Feature extraction

/// Band edges in Hz, matching the browser analyser so both agree on a track.
private let bassRange: (Float, Float) = (20, 250)
private let midRange: (Float, Float) = (250, 2_000)
private let trebleRange: (Float, Float) = (2_000, 16_000)

private let fftSize = 2048
private let binCount = fftSize / 2

/// Must match `packages/shared/src/spectrum.ts`, which is the tested reference.
/// The listener can switch audio source in settings, and the picture must not
/// change when they do.
private let bandCount = 64
private let waveformPoints = 128
private let waveformCentre: UInt8 = 128
private let bandLowHz: Float = 30
private let bandHighHz: Float = 16_000

/// Computes spectral features from interleaved audio, one hop at a time.
final class Analyser {
    private var sampleRate: Float = 48_000

    private let log2n: vDSP_Length
    private let setup: FFTSetup
    private var window = [Float](repeating: 0, count: fftSize)
    private var buffer = [Float](repeating: 0, count: fftSize)
    private var windowed = [Float](repeating: 0, count: fftSize)
    private var magnitudes = [Float](repeating: 0, count: binCount)
    private var previous = [Float](repeating: 0, count: binCount)
    private var filled = 0

    /// Recent spectral-flux history, used for an adaptive onset threshold. A
    /// fixed threshold would fire on every frame of a dense mix.
    private var fluxHistory = [Float]()
    private var cooldown = 0

    private let lock = NSLock()
    private var latest = Features()
    private var pendingOnset = false

    struct Features {
        var bass: Float = 0
        var mid: Float = 0
        var treble: Float = 0
        var rms: Float = 0
        var centroid: Float = 0
        /// 64 log-spaced bands, 0-255.
        var bands = [UInt8](repeating: 0, count: bandCount)
        /// 128 envelope points centred on 128.
        var wave = [UInt8](repeating: waveformCentre, count: waveformPoints)
    }

    init() {
        log2n = vDSP_Length(log2(Float(fftSize)))
        guard let created = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else {
            fail("could not create FFT setup", code: "fft")
        }
        setup = created
        vDSP_hann_window(&window, vDSP_Length(fftSize), Int32(vDSP_HANN_NORM))
    }

    deinit { vDSP_destroy_fftsetup(setup) }

    func setSampleRate(_ rate: Float) { sampleRate = rate }

    /// Feed mono samples. Called from the audio thread; keeps allocation out of
    /// the hot path by reusing preallocated buffers.
    func append(_ samples: UnsafePointer<Float>, count: Int) {
        var index = 0
        while index < count {
            let take = min(fftSize - filled, count - index)
            for i in 0..<take { buffer[filled + i] = samples[index + i] }
            filled += take
            index += take
            if filled == fftSize {
                analyse()
                // 50% overlap: keeps onset timing tight without doubling cost.
                let half = fftSize / 2
                for i in 0..<half { buffer[i] = buffer[i + half] }
                filled = half
            }
        }
    }

    private func analyse() {
        vDSP_vmul(buffer, 1, window, 1, &windowed, 1, vDSP_Length(fftSize))

        var real = [Float](repeating: 0, count: binCount)
        var imag = [Float](repeating: 0, count: binCount)

        real.withUnsafeMutableBufferPointer { realPtr in
            imag.withUnsafeMutableBufferPointer { imagPtr in
                var split = DSPSplitComplex(realp: realPtr.baseAddress!, imagp: imagPtr.baseAddress!)
                windowed.withUnsafeBufferPointer { input in
                    input.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: binCount) {
                        vDSP_ctoz($0, 2, &split, 1, vDSP_Length(binCount))
                    }
                }
                vDSP_fft_zrip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                vDSP_zvabs(&split, 1, &magnitudes, 1, vDSP_Length(binCount))
            }
        }

        // Normalise so values are comparable with the browser's 0..255 bytes
        // scaled to 0..1, rather than depending on FFT length.
        var scale = 2.0 / Float(fftSize)
        vDSP_vsmul(magnitudes, 1, &scale, &magnitudes, 1, vDSP_Length(binCount))

        var rms: Float = 0
        vDSP_rmsqv(buffer, 1, &rms, vDSP_Length(fftSize))

        let binWidth = sampleRate / Float(fftSize)
        func bandEnergy(_ range: (Float, Float)) -> Float {
            let from = max(0, Int((range.0 / binWidth).rounded()))
            let to = min(binCount - 1, Int((range.1 / binWidth).rounded()))
            if to < from { return 0 }
            var total: Float = 0
            for i in from...to { total += magnitudes[i] }
            return total / Float(to - from + 1)
        }

        var weighted: Float = 0
        var total: Float = 0
        for i in 0..<binCount {
            weighted += Float(i) * magnitudes[i]
            total += magnitudes[i]
        }

        // Rectified spectral flux: only rises count, so a fading note is not an
        // onset.
        var flux: Float = 0
        for i in 0..<binCount {
            let rise = magnitudes[i] - previous[i]
            if rise > 0 { flux += rise }
        }
        previous = magnitudes

        let mean = fluxHistory.isEmpty ? 0 : fluxHistory.reduce(0, +) / Float(fluxHistory.count)
        fluxHistory.append(flux)
        if fluxHistory.count > 43 { fluxHistory.removeFirst() }

        var onset = false
        if cooldown > 0 {
            cooldown -= 1
        } else if fluxHistory.count >= 8 && flux > mean * 1.6 && flux > 0.004 {
            onset = true
            cooldown = 4
        }

        // Compress: raw linear magnitudes sit very low for ordinary music, so a
        // little gain keeps the visual range usable without clipping loud tracks.
        func shape(_ value: Float) -> Float { min(1, max(0, value * 12)) }

        // Log-spaced bands. Linear bins would crowd nearly all musical energy
        // into the first few bars and leave the rest of a display motionless.
        var bands = [UInt8](repeating: 0, count: bandCount)
        let ratio = bandHighHz / bandLowHz
        for band in 0..<bandCount {
            let fromHz = bandLowHz * powf(ratio, Float(band) / Float(bandCount))
            let toHz = bandLowHz * powf(ratio, Float(band + 1) / Float(bandCount))
            var first = Int(floorf(fromHz / binWidth))
            var last = Int(ceilf(toHz / binWidth)) - 1
            if last < first { last = first }          // never an empty low band
            first = min(max(0, first), binCount - 1)
            last = min(max(first, last), binCount - 1)

            var peak: Float = 0
            for i in first...last where magnitudes[i] > peak { peak = magnitudes[i] }
            bands[band] = UInt8(min(255, max(0, shape(peak) * 255)))
        }

        // Envelope trace: slices alternate max and min, so a loud passage reads
        // as a band rather than a line pinned to one side.
        var wave = [UInt8](repeating: waveformCentre, count: waveformPoints)
        let step = Float(fftSize) / Float(waveformPoints)
        for i in 0..<waveformPoints {
            let first = min(fftSize - 1, Int(Float(i) * step))
            let last = min(fftSize - 1, max(first, Int(Float(i + 1) * step) - 1))
            var highest: Float = -1
            var lowest: Float = 1
            for j in first...last {
                if buffer[j] > highest { highest = buffer[j] }
                if buffer[j] < lowest { lowest = buffer[j] }
            }
            let chosen = i % 2 == 0 ? highest : lowest
            wave[i] = UInt8(min(255, max(0, (chosen * 0.5 + 0.5) * 255)))
        }

        lock.lock()
        latest = Features(
            bass: shape(bandEnergy(bassRange)),
            mid: shape(bandEnergy(midRange)),
            treble: shape(bandEnergy(trebleRange)),
            rms: min(1, max(0, rms * 3)),
            centroid: total > 0 ? min(1, (weighted / total) / Float(binCount)) : 0,
            bands: bands,
            wave: wave
        )
        if onset { pendingOnset = true }
        lock.unlock()
    }

    /// Take the newest features, clearing the onset flag so each beat is
    /// reported exactly once even though frames are emitted slower than hops.
    func take() -> (Features, Bool) {
        lock.lock()
        defer { pendingOnset = false; lock.unlock() }
        return (latest, pendingOnset)
    }
}

// MARK: - Core Audio plumbing

func defaultOutputDevice() -> AudioDeviceID {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var device = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
    if status != noErr { fail("no default output device (\(status))", code: "no-output") }
    return device
}

func deviceUID(_ device: AudioDeviceID) -> String {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceUID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var uid: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    let status = withUnsafeMutablePointer(to: &uid) {
        AudioObjectGetPropertyData(device, &address, 0, nil, &size, $0)
    }
    if status != noErr { fail("could not read output device UID (\(status))", code: "no-uid") }
    return uid as String
}

func sampleRate(of device: AudioDeviceID) -> Float {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyNominalSampleRate,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var rate: Float64 = 48_000
    var size = UInt32(MemoryLayout<Float64>.size)
    AudioObjectGetPropertyData(device, &address, 0, nil, &size, &rate)
    return Float(rate)
}

// MARK: - Main

guard #available(macOS 14.2, *) else {
    fail("Core Audio process taps require macOS 14.2 or later", code: "unsupported")
}

let analyser = Analyser()
let output = defaultOutputDevice()
let outputUID = deviceUID(output)
analyser.setSampleRate(sampleRate(of: output))

// A global tap excluding nothing: everything the machine plays.
let tapDescription = CATapDescription(monoGlobalTapButExcludeProcesses: [])
tapDescription.name = "Resonance Tap"
tapDescription.isPrivate = true
tapDescription.muteBehavior = .unmuted   // never interfere with what is playing

var tapID = AudioObjectID(kAudioObjectUnknown)
let tapStatus = AudioHardwareCreateProcessTap(tapDescription, &tapID)
if tapStatus != noErr {
    fail("could not create process tap (\(tapStatus))", code: "tap-failed")
}

// The tap is only usable through an aggregate device.
let aggregateUID = UUID().uuidString
let aggregateDescription: [String: Any] = [
    kAudioAggregateDeviceNameKey: "Resonance Aggregate",
    kAudioAggregateDeviceUIDKey: aggregateUID,
    kAudioAggregateDeviceMainSubDeviceKey: outputUID,
    kAudioAggregateDeviceIsPrivateKey: true,
    kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
    kAudioAggregateDeviceTapListKey: [[
        kAudioSubTapDriftCompensationKey: true,
        kAudioSubTapUIDKey: tapDescription.uuid.uuidString,
    ]],
]

var aggregateID = AudioObjectID(kAudioObjectUnknown)
let aggregateStatus = AudioHardwareCreateAggregateDevice(
    aggregateDescription as CFDictionary, &aggregateID)
if aggregateStatus != noErr {
    fail("could not create aggregate device (\(aggregateStatus))", code: "aggregate-failed")
}

var procID: AudioDeviceIOProcID?
let ioStatus = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, nil) {
    _, inputData, _, _, _ in
    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
    guard let first = buffers.first, let raw = first.mData else { return }
    let frames = Int(first.mDataByteSize) / MemoryLayout<Float>.size
    analyser.append(raw.assumingMemoryBound(to: Float.self), count: frames)
}
if ioStatus != noErr { fail("could not install IO proc (\(ioStatus))", code: "ioproc-failed") }

// This is the call that prompts for permission the first time. Nothing has asked
// the user for anything before this point.
let startStatus = AudioDeviceStart(aggregateID, procID)
if startStatus != noErr {
    fail("could not start capture — permission likely denied (\(startStatus))", code: "denied")
}

print("{\"type\":\"ready\"}")
fflush(stdout)
log("resonance-audio: capturing system audio")

/// Signal sources must outlive the loop that creates them, or they are released
/// immediately and the handlers never fire.
var signalSources: [DispatchSourceSignal] = []

func shutdown() {
    AudioDeviceStop(aggregateID, procID)
    if let procID { AudioDeviceDestroyIOProcID(aggregateID, procID) }
    AudioHardwareDestroyAggregateDevice(aggregateID)
    AudioHardwareDestroyProcessTap(tapID)
    exit(0)
}

for signalNumber in [SIGINT, SIGTERM] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
    source.setEventHandler { shutdown() }
    source.resume()
    signalSources.append(source)
}

// 30Hz: onsets are detected at the full hop rate above and merely flagged here,
// so transient fidelity does not depend on this interval, and the consumer's own
// smoothing makes it look continuous.
let timer = DispatchSource.makeTimerSource(queue: .main)
timer.schedule(deadline: .now(), repeating: .milliseconds(33))
timer.setEventHandler {
    let (features, onset) = analyser.take()

    // Built by joining parts rather than one long `+` chain of interpolations.
    // Swift's type checker takes exponential time on long concatenations of
    // interpolated strings — the previous single-expression version pushed a
    // two-second build past ten minutes.
    func round3(_ value: Float) -> String { String(format: "%.3f", value) }
    // Base64 rather than JSON number arrays: 192 numbers per frame at 30Hz would
    // be bulky and unreadable in a log, where this is a couple of short strings.
    let spectrum = Data(features.bands).base64EncodedString()
    let waveform = Data(features.wave).base64EncodedString()

    var parts: [String] = []
    parts.append("\"type\":\"frame\"")
    parts.append("\"bass\":" + round3(features.bass))
    parts.append("\"mid\":" + round3(features.mid))
    parts.append("\"treble\":" + round3(features.treble))
    parts.append("\"rms\":" + round3(features.rms))
    parts.append("\"centroid\":" + round3(features.centroid))
    parts.append("\"onset\":" + (onset ? "true" : "false"))
    parts.append("\"spectrum\":\"" + spectrum + "\"")
    parts.append("\"waveform\":\"" + waveform + "\"")
    print("{" + parts.joined(separator: ",") + "}")
    fflush(stdout)
}
timer.resume()

dispatchMain()
