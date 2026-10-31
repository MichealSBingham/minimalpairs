"""Pinned, target-independent formant adapters for OFFLINE research.

The heat-map network is noncausal. Its raw outputs are not speech detection,
pronunciation scores, calibrated confidence, or a live-display guarantee.
"""
from pathlib import Path
from types import SimpleNamespace
import importlib.util
import sys
import time

import numpy as np
import parselmouth
from scipy import signal
import torch
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / 'models/heatmap-e8a11b6'
CEILINGS = (4500, 5000, 5500, 6000, 6500, 7000)
AGREEMENT_HZ = np.array([120., 220.])


def prepare_audio(audio, sample_rate):
    x = np.asarray(audio, dtype=np.float64)
    if x.ndim != 1 or len(x) == 0 or not np.isfinite(x).all():
        raise ValueError('Expected finite, nonempty mono audio.')
    if not 8000 <= sample_rate <= 96000:
        raise ValueError('Unsupported sample rate.')
    if sample_rate != 16000:
        from math import gcd
        d = gcd(int(sample_rate), 16000)
        x = signal.resample_poly(x, 16000 // d, int(sample_rate) // d)
    return x.astype(np.float32)


def heatmap_features(x):
    # Match torchaudio Spectrogram(normalized=True), which divides power by
    # WINDOW energy, not torch.stft(normalized=True)'s FFT-size normalization.
    y = torch.from_numpy(signal.lfilter([1., -.97], [1.], x).astype(np.float32))
    if y.numel() <= 256:
        raise ValueError('Heat-map inference requires more than 16 ms of audio.')
    window = torch.hann_window(512)
    z = torch.stft(y, n_fft=512, hop_length=160, win_length=512,
                   window=window, center=True, pad_mode='reflect',
                   normalized=False, onesided=True, return_complex=True)
    return (z.abs().square() / window.square().sum()).T.contiguous()


class HeatmapTracker:
    def __init__(self):
        # Source is pinned and inspected. Only the model definition is imported;
        # no upstream installer, loader, filesystem traversal or runner executes.
        utils_spec = importlib.util.spec_from_file_location('heatmap_vendor_utils', MODEL / 'utils.py')
        utils = importlib.util.module_from_spec(utils_spec)
        utils_spec.loader.exec_module(utils)
        old = sys.modules.get('utils')
        sys.modules['utils'] = utils
        try:
            spec = importlib.util.spec_from_file_location('heatmap_vendor_model', MODEL / 'model.py')
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
        finally:
            if old is None:
                sys.modules.pop('utils', None)
            else:
                sys.modules['utils'] = old
        hp = SimpleNamespace(n_fft=512, dropout=.2, bias=True, bias1d=False,
                             f1_blocks=2, f2_blocks=2, f3_blocks=2)
        self.model = mod.FormantTracker(hp).eval()
        weights = torch.load(MODEL / 'saved_ckpts/196_1125.ckpt',
                             map_location='cpu', weights_only=True)
        self.model.load_state_dict(weights, strict=True)
        self.kernel = utils.get_smoothing_kernel(7, 1.)

    @torch.inference_mode()
    def predict(self, x):
        features = heatmap_features(x)
        # Upstream inference pads variable-length batches with zero spectra.
        # Fix the right context explicitly so end-of-recording predictions do
        # not depend on the duration of other recordings in the same batch.
        # 64 frames exceed this model's longest convolutional receptive radius.
        out, _ = self.model(F.pad(features, (0, 0, 0, 64))[None])
        smooth = F.conv2d(out.reshape(-1, 1, out.shape[2], out.shape[3]),
                          self.kernel, padding=3).reshape_as(out)
        # Preserve upstream trained-bin convention for reproducibility. This
        # differs slightly from the STFT frequency axis; do not silently change.
        hz = (smooth.argmax(dim=3).float() + .5) * (8000 / 257)
        return np.arange(features.shape[0]) / 100., hz[0, :, :features.shape[0]].T.numpy()


class BurgBank:
    def __init__(self, x):
        sound = parselmouth.Sound(x, 16000)
        self.bank = {c: sound.to_formant_burg(time_step=.01,
                        max_number_of_formants=5, maximum_formant=c,
                        window_length=.025, pre_emphasis_from=50)
                     for c in CEILINGS}

    def at(self, t):
        return {c: np.array([f.get_value_at_time(i, t) for i in (1, 2)])
                for c, f in self.bank.items()}


def valid(pair):
    return bool(np.isfinite(pair).all() and 100 < pair[0] < 1500
                and pair[0] + 100 < pair[1] < 4500)


def record(pair, accepted=True, **extra):
    finite = np.isfinite(pair).all()
    return {'accepted': bool(accepted and finite),
            'f1': float(pair[0]) if finite else None,
            'f2': float(pair[1]) if finite else None, **extra}


def estimates(burg, neural):
    """Never receives target vowel, transcript, speaker group or reference label."""
    a, b = burg[5000], burg[5500]
    agreement = np.isfinite([a, b]).all() and np.all(np.abs(a - b) <= AGREEMENT_HZ)
    results = {
        'burg5500': record(b),
        'burg_two_ceiling': record((a + b) / 2, agreement),
        'heatmap': record(neural),
    }
    # Independent-method agreement: include raw candidate even on abstention.
    gate = valid(b) and valid(neural) and np.all(np.abs(b - neural) <= AGREEMENT_HZ)
    results['cross_method_fixed'] = record((b + neural) / 2, gate)
    # Candidate hypothesis: let the neural estimate choose an acoustically
    # plausible ceiling; never use the expected vowel to select that ceiling.
    candidates = [(np.sum(((p - neural) / AGREEMENT_HZ) ** 2), c, p)
                  for c, p in burg.items() if valid(p) and valid(neural)]
    if candidates:
        _, ceiling, chosen = min(candidates, key=lambda z: (z[0], z[1]))
        gate = np.all(np.abs(chosen - neural) <= AGREEMENT_HZ)
        results['cross_method_multiceiling'] = record((chosen + neural) / 2, gate,
                                                      ceiling=ceiling)
    else:
        results['cross_method_multiceiling'] = record(np.array([np.nan, np.nan]), False)
    return results


def input_gate(x):
    """Engineering eligibility, NOT calibrated speech or vowel detection.

    Relative frame periodicity avoids rejecting sustained vowels just because
    their absolute level is quiet. Silence, clipping, narrowband tones and
    broadband noise receive separate explicit reasons.
    """
    if len(x) < 1600:
        return False, 'too_short'
    if not np.isfinite(x).all():
        return False, 'nonfinite'
    x = np.asarray(x, dtype=np.float64)
    rms = float(np.sqrt(np.mean(x*x)))
    if rms < .0001:
        return False, 'near_silence'
    if np.mean(np.abs(x) >= .985) > .01:
        return False, 'clipping'
    best_periodicity = 0.
    for start in range(0, len(x) - 800 + 1, 400):
        w = x[start:start+800] - np.mean(x[start:start+800])
        if np.mean(w*w) < max(1e-10, rms*rms*.1):
            continue
        ac = signal.correlate(w, w, mode='full', method='fft')[799:]
        best_periodicity = max(best_periodicity, float(np.max(ac[32:229]) / (ac[0]+1e-20)))
    if best_periodicity < .3:
        return False, 'weak_periodicity'
    _, power = signal.welch(x, 16000, nperseg=min(2048, len(x)))
    # Harmonic vowels have distributed harmonics; a sine/chirp is not a vowel.
    concentration = float(np.sort(power)[-3:].sum() / (power.sum()+1e-20))
    if concentration > .96:
        return False, 'narrowband_tone'
    return True, 'eligible_unverified'
