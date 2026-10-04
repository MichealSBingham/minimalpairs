/** Replay the correct match, never the chosen distractor. Diagnostics reveal nothing. */
export async function runAnswerFeedback({ diagnostic, reference, play, wait, active, advance }: {
  diagnostic: boolean; reference: 'a' | 'b'; play: (sample: 'a' | 'b' | 'x') => Promise<void>;
  wait: (ms: number) => Promise<void>; active: () => boolean; advance: () => void;
}) {
  if (!active()) return;
  if (!diagnostic) {
    await wait(220); // Keep the answer chime separate from the speech.
    if (!active()) return;
    await play(reference);
    await wait(350);
    if (!active()) return;
    await play('x');
  }
  await wait(diagnostic ? 350 : 650);
  if (active()) advance();
}

export function answerCue(correct: boolean) {
  if (!correct) { try { navigator.vibrate?.([70, 40, 70]); } catch {} return; }
  try {
    const context = new AudioContext();
    void context.resume().then(() => {
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.setValueAtTime(880, context.currentTime + .08);
      gain.gain.setValueAtTime(.035, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .16);
      oscillator.start(); oscillator.stop(context.currentTime + .18);
      oscillator.onended = () => { void context.close(); };
    }).catch(() => { void context.close(); });
  } catch { /* Feedback remains usable when browser audio cues are unavailable. */ }
}
