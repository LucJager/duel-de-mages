import { load, save } from './storage';

export type Sfx = 'fireball' | 'bonk' | 'shield' | 'trap' | 'death' | 'victory';

let muted = load('dm-muted') === '1';

export const isMuted = () => muted;

export function setMuted(value: boolean) {
  muted = value;
  save('dm-muted', value ? '1' : '0');
}

/** Joue un son ; échec silencieux si le fichier manque ou si l'autoplay est bloqué. */
export function play(name: Sfx) {
  if (muted) return;
  const audio = new Audio(`/assets/sfx/${name}.mp3`);
  audio.volume = 0.6;
  audio.play().catch(() => {});
}
