let audio: AudioContext | null = null;

/** Short two-tone notification chime synthesised with WebAudio. */
export function playChime(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const start = audio.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      const t = start + i * 0.15;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain).connect(audio!.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  } catch {
    // Audio is optional; never break the shell because of it.
  }
}
