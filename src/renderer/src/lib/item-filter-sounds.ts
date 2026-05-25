import { customSoundForId, type CustomItemFilterSound } from "./item-filters";

let audioContext: AudioContext | null = null;

export async function playItemFilterSound(soundId: string, volume: number, customSounds: CustomItemFilterSound[] = []) {
  const customSound = customSoundForId(soundId, customSounds);
  if (customSound) {
    await playCustomAudio(customSound.src, volume);
    return;
  }

  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext = audioContext ?? new AudioContextClass();
  if (audioContext.state === "suspended") await audioContext.resume();
  const gain = audioContext.createGain();
  gain.gain.value = Math.max(0, Math.min(volume, 100)) / 100;
  gain.connect(audioContext.destination);
  playSoundPreset(audioContext, gain, soundId);
}

function playCustomAudio(src: string, volume: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(src);
    audio.volume = Math.max(0, Math.min(volume, 100)) / 100;
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("Custom audio failed to play."));
    const playResult = audio.play();
    if (playResult) playResult.catch(reject);
    window.setTimeout(resolve, 5000);
  });
}

function playSoundPreset(context: AudioContext, output: GainNode, soundId: string) {
  const now = context.currentTime;
  if (soundId === "crystal-tink") {
    playImpactNoise(context, output, now, 1.95, 0.9, 360, 11_800, 0.035);
    playBell(context, output, now, [690, 1710, 4520, 5680, 6820, 9020], 2.02, 0.95);
    playTone(context, output, 3440, now + 0.018, 1.45, "square", 0.16, 5);
    return;
  }
  if (soundId === "coin-ping") {
    playImpactNoise(context, output, now, 1.05, 0.45, 620, 8200, 0.024);
    playBell(context, output, now, [880, 1760, 3520, 5280], 1.12, 0.55);
    return;
  }
  if (soundId === "bell-chime") {
    playImpactNoise(context, output, now, 1.55, 0.56, 420, 9200, 0.03);
    playBell(context, output, now, [520, 1040, 2080, 4160, 6240], 1.62, 0.68);
    return;
  }
  if (soundId === "rune-spark") {
    playImpactNoise(context, output, now, 1.72, 0.7, 820, 12_400, 0.026);
    [780, 1560, 3120, 4680, 6240, 9360].forEach((frequency, index) => {
      playTone(context, output, frequency, now + index * 0.018, 1.5 - index * 0.08, index % 2 === 0 ? "triangle" : "sawtooth", 0.52 / (index + 1), index % 2 === 0 ? 7 : -6);
    });
    return;
  }
  if (soundId === "deep-gong") {
    playImpactNoise(context, output, now, 1.45, 0.48, 90, 3600, 0.042);
    playBell(context, output, now, [132, 198, 396, 792, 1584], 1.6, 0.62);
    return;
  }
  if (soundId === "soft-pop") {
    playImpactNoise(context, output, now, 0.82, 0.28, 150, 2800, 0.032);
    playBell(context, output, now, [330, 660, 990], 0.75, 0.34);
    return;
  }
  if (soundId === "bright-cascade") {
    playImpactNoise(context, output, now, 1.9, 0.78, 740, 12_000, 0.024);
    [988, 1319, 1760, 2349, 3136, 4186].forEach((frequency, index) => {
      playTone(context, output, frequency * 1.35, now + index * 0.045, 1.65 - index * 0.1, index % 2 === 0 ? "sine" : "triangle", 0.58 / (index + 1), index % 2 === 0 ? -4 : 4);
    });
    return;
  }
  if (soundId === "low-pulse") {
    playImpactNoise(context, output, now, 1.05, 0.34, 60, 1800, 0.04);
    playBell(context, output, now, [82, 123, 246, 492], 1.05, 0.45);
    return;
  }

  playImpactNoise(context, output, now, 1.9, 0.8, 360, 11_000, 0.03);
  playBell(context, output, now, [690, 1710, 4520, 5680, 6820], 1.95, 0.88);
}

function playBell(context: AudioContext, output: GainNode, start: number, frequencies: number[], duration: number, level: number) {
  frequencies.forEach((frequency, index) => {
    playTone(
      context,
      output,
      frequency,
      start + index * 0.012,
      duration * (1 - index * 0.08),
      index % 2 === 0 ? "sine" : "triangle",
      level / (index + 1),
      index % 2 === 0 ? 0 : 7,
    );
  });
}

function playTone(
  context: AudioContext,
  output: GainNode,
  frequency: number,
  start: number,
  duration: number,
  type: OscillatorType,
  level: number,
  detune = 0,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  oscillator.detune.value = detune;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(level, 0.0001), start + 0.006);
  gain.gain.exponentialRampToValueAtTime(Math.max(level * 0.34, 0.0001), start + Math.min(0.16, duration * 0.22));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(output);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function playImpactNoise(
  context: AudioContext,
  output: GainNode,
  start: number,
  duration: number,
  level: number,
  lowCut: number,
  highCut: number,
  attackSeconds: number,
) {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    const progress = index / frameCount;
    const decay = Math.exp(-progress * 5.2);
    const attackBoost = progress < 0.035 ? 1.9 : 1;
    data[index] = (Math.random() * 2 - 1) * decay * attackBoost;
  }

  const source = context.createBufferSource();
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const peaking = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  highpass.type = "highpass";
  highpass.frequency.value = lowCut;
  lowpass.type = "lowpass";
  lowpass.frequency.value = highCut;
  peaking.type = "peaking";
  peaking.frequency.value = 5600;
  peaking.Q.value = 1.4;
  peaking.gain.value = 7;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(level, 0.0001), start + attackSeconds);
  gain.gain.exponentialRampToValueAtTime(Math.max(level * 0.2, 0.0001), start + Math.min(0.22, duration * 0.24));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(peaking);
  peaking.connect(gain);
  gain.connect(output);
  source.start(start);
  source.stop(start + duration + 0.02);
}
