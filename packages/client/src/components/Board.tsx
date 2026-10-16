import type { CSSProperties, ReactNode } from 'react';
import { isLava, samePos } from '@dm/shared';
import type { Pos } from '@dm/shared';
import { nextLavaRound } from '../plan';

/** Style d'un élément posé sur la case `p` (calque de l'arène). */
export const at = (p: Pos, extra?: CSSProperties): CSSProperties =>
  ({ '--x': p.x, '--y': p.y, ...extra }) as CSSProperties;

interface Props {
  size: number;
  /** Manche servant au calcul de la lave. */
  round: number;
  /** Cases cliquables surlignées. */
  targets?: Pos[];
  onCellClick?: (p: Pos) => void;
  className?: string;
  children?: ReactNode;
}

export function Board({ size, round, targets = [], onCellClick, className = '', children }: Props) {
  const next = nextLavaRound(round + 1);
  const warn = next !== null && next - round <= 2;
  const cells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = { x, y };
      const lava = isLava(p, size, round);
      const danger = !lava && warn && isLava(p, size, next!);
      const target = targets.some((t) => samePos(t, p));
      cells.push(
        <button
          key={`${x},${y}`}
          type="button"
          className={`cell${lava ? ' lava' : ''}${danger ? ' danger' : ''}${target ? ' target' : ''}${(x + y) % 2 ? ' odd' : ''}`}
          disabled={!target}
          onClick={() => onCellClick?.(p)}
          aria-label={`Case ${x + 1},${y + 1}`}
        />,
      );
    }
  }
  return (
    <div className={`board ${className}`} style={{ '--n': size } as CSSProperties}>
      <div className="cells">{cells}</div>
      <div className="layer">{children}</div>
    </div>
  );
}
