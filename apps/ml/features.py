"""Speech features for Voice Lab (research only, rule 2.8). Stdlib only.

The output matches SpeechFeatures in packages/research/src/features.ts; bump FEATURE_VERSION
whenever the maths changes, so old and new rows are never mixed in one analysis.
"""
import array
import io
import math
import sys
import wave

FEATURE_VERSION = "pcm-energy-1"
FRAME_MS = 25
MIN_PAUSE_MS = 250
VOICED_DBFS = -40.0


def extract(wav_bytes: bytes) -> dict:
    with wave.open(io.BytesIO(wav_bytes)) as w:
        if w.getsampwidth() != 2:
            raise ValueError("expected 16-bit PCM")
        rate, channels = w.getframerate(), w.getnchannels()
        pcm = array.array("h", w.readframes(w.getnframes()))
    if sys.byteorder == "big":
        pcm.byteswap()
    mono = pcm[::channels]
    duration_ms = round(len(mono) * 1000 / rate)
    if duration_ms > 120_000:
        raise ValueError("longer than 120 s")
    step = max(1, rate * FRAME_MS // 1000)
    frames = [mono[i : i + step] for i in range(0, len(mono) - step + 1, step)]
    db = [20 * math.log10(max(math.sqrt(sum(x * x for x in f) / len(f)), 1) / 32768) for f in frames]
    voiced = [d > VOICED_DBFS for d in db]

    pauses, run = [], 0
    started = False
    for v in voiced:
        if v:
            if started and run * FRAME_MS >= MIN_PAUSE_MS:
                pauses.append(run * FRAME_MS)
            started, run = True, 0
        else:
            run += 1
    total = max(math.sqrt(sum(x * x for x in mono) / max(len(mono), 1)), 1)
    return {
        "featureVersion": FEATURE_VERSION,
        "durationMs": duration_ms,
        "voicedRatio": round(sum(voiced) / len(voiced), 4) if voiced else 0.0,
        "pauseCount": len(pauses),
        "meanPauseMs": round(sum(pauses) / len(pauses), 1) if pauses else 0.0,
        "rmsDbfs": max(-120.0, round(20 * math.log10(total / 32768), 2)),
    }


def _tone(segments, rate=8000) -> bytes:
    """[(ms, amplitude)] → a mono 16-bit WAV; 0 amplitude is silence."""
    pcm = array.array("h")
    for ms, amp in segments:
        n = rate * ms // 1000
        pcm.extend(int(amp * math.sin(2 * math.pi * 220 * i / rate)) for i in range(n))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1), w.setsampwidth(2), w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


if __name__ == "__main__":
    # 1 s speech, 500 ms pause, 1 s speech, 100 ms gap (too short to count), 400 ms speech.
    f = extract(_tone([(1000, 8000), (500, 0), (1000, 8000), (100, 0), (400, 8000)]))
    assert f["durationMs"] == 3000, f
    assert f["pauseCount"] == 1 and f["meanPauseMs"] == 500.0, f
    assert f["voicedRatio"] == 0.8, f  # 2.4 s voiced of 3 s
    assert -20 < f["rmsDbfs"] < -10, f
    assert extract(_tone([(500, 0)]))["voicedRatio"] == 0.0
    print("features ok", f)
