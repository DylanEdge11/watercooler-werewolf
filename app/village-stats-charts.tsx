'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

/**
 * The drawing pieces of the Village stats view: bars, columns, a step line, a vote grid, and the
 * table every chart can be read as. All of it is plain HTML and SVG, with one mark color and one
 * emphasis color, so a chart never relies on color alone: values sit beside the marks, and
 * `DataTable` lists the same numbers.
 */

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** A round axis maximum at or above the value: 4, 5, 10, 20, 50, 100, and so on. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

export function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <details className="vs-table">
      <summary>View as table</summary>
      <div className="vs-table-scroll">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead><tr>{head.map((cell, index) => <th key={cell} scope="col" className={index === 0 ? undefined : 'num'}>{cell}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => column === 0 ? <th key={column} scope="row">{cell}</th> : <td key={column} className="num">{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

export interface BarRow {
  id: string;
  label: string;
  value: number;
  /** The mark that tells the story: drawn in the accent color. */
  emphasised?: boolean;
}

/** Horizontal bars, one per row, with the value at the tip. Rows beyond `limit` wait behind "Show all". */
export function BarList({ rows, max, noun, label, limit = 12 }: { rows: BarRow[]; max: number; noun: string; label: string; limit?: number }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, limit);
  const scale = Math.max(max, 1);
  return (
    <>
      <ol className="vs-bars" aria-label={label}>
        {shown.map((row) => (
          <li key={row.id} className="vs-bar-row">
            <span className="vs-bar-name" title={row.label}>{row.label}</span>
            <span className="vs-bar-track"><span className={`vs-bar${row.emphasised ? ' lead' : ''}`} style={{ width: `${Math.max(2, (row.value / scale) * 100)}%` }} /></span>
            <span className="vs-bar-value">{row.value.toLocaleString()}<span className="sr-only"> {row.value === 1 ? noun : `${noun}s`}</span></span>
          </li>
        ))}
      </ol>
      {rows.length > limit && <button type="button" className="text-button vs-show-all" onClick={() => setShowAll((current) => !current)}>{showAll ? 'Show fewer' : `Show all ${rows.length}`}</button>}
    </>
  );
}

/** Left and right arrows, Home, and End move through a chart's points; leaving puts the readout back on its default. */
function useActivePoint(length: number, fallback: number) {
  const [active, setActive] = useState<number | null>(null);
  const index = Math.max(0, Math.min(active ?? fallback, length - 1));
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const last = length - 1;
    const next = event.key === 'ArrowRight' ? Math.min(index + 1, last)
      : event.key === 'ArrowLeft' ? Math.max(index - 1, 0)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };
  return { index, setActive, onKeyDown, reset: () => setActive(null) };
}

const AXIS = { left: 34, right: 8, top: 10, bottom: 26 };

/**
 * The width a chart draws at, in pixels. Charts are drawn at their real size, not scaled from a fixed
 * canvas, so axis text stays readable on a phone.
 */
function useChartWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(260, Math.round(element.clientWidth))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Every how-manyth axis label to print so neighbours stay about 56px apart. */
function labelStep(count: number, plotWidth: number): number {
  return Math.max(1, Math.ceil(count / Math.max(3, Math.floor(plotWidth / 56))));
}

/** Axis tick positions: 0, half, and the top. */
function yTicks(top: number): number[] {
  return top % 2 === 0 ? [0, top / 2, top] : [0, top];
}

function Grid({ top, height, width }: { top: number; height: number; width: number }) {
  const plot = height - AXIS.top - AXIS.bottom;
  return (
    <>
      {yTicks(top).map((tick) => {
        const y = AXIS.top + plot - (tick / top) * plot;
        return (
          <g key={tick}>
            <line className="vs-grid" x1={AXIS.left} x2={width - AXIS.right} y1={y} y2={y} />
            <text className="vs-axis-text" x={AXIS.left - 6} y={y + 3.5} textAnchor="end">{tick}</text>
          </g>
        );
      })}
    </>
  );
}

export interface ColumnDatum {
  key: string;
  /** Full wording for the readout and the table, e.g. "Tue 6 Oct". */
  label: string;
  /** Short wording under the axis, e.g. "6 Oct". */
  axis: string;
  value: number;
}

/**
 * Columns with a readout line above them. The tallest column is emphasised until the pointer or the
 * arrow keys choose another.
 */
export function ColumnChart({ data, title, noun, tableHead }: { data: ColumnDatum[]; title: string; noun: string; tableHead: string }) {
  const peak = data.reduce((best, datum, index) => (datum.value > (data[best]?.value ?? -1) ? index : best), 0);
  const { index, setActive, onKeyDown, reset } = useActivePoint(data.length, peak);
  const [plotRef, width] = useChartWidth();
  const height = 190;
  const top = niceMax(Math.max(0, ...data.map((datum) => datum.value)));
  const plotWidth = width - AXIS.left - AXIS.right;
  const plotHeight = height - AXIS.top - AXIS.bottom;
  const slot = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.min(24, Math.max(2, slot - 2));
  const labelEvery = labelStep(data.length, plotWidth);
  const active = data[index];
  return (
    <figure className="vs-chart">
      <figcaption className="vs-chart-title">{title}</figcaption>
      <p className="vs-readout" aria-live="polite">{active ? <><strong>{active.value.toLocaleString()} {active.value === 1 ? noun : `${noun}s`}</strong> · {active.label}</> : null}</p>
      <div className="vs-plot" ref={plotRef} tabIndex={0} role="group" aria-label={`${title}. Use the left and right arrow keys to read each value.`} onKeyDown={onKeyDown} onBlur={reset} onPointerLeave={(event) => { if (event.pointerType === 'mouse') reset(); }}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden="true">
          <Grid top={top} height={height} width={width} />
          {data.map((datum, position) => {
            const x = AXIS.left + position * slot + (slot - barWidth) / 2;
            const barHeight = (datum.value / top) * plotHeight;
            const base = AXIS.top + plotHeight;
            const radius = Math.min(4, barHeight, barWidth / 2);
            return (
              <g key={datum.key}>
                {datum.value > 0 && <path className={`vs-column${position === index ? ' lead' : ''}`} d={`M${x},${base} V${base - barHeight + radius} a${radius},${radius} 0 0 1 ${radius},${-radius} H${x + barWidth - radius} a${radius},${radius} 0 0 1 ${radius},${radius} V${base} Z`} />}
                <rect className="vs-hit" x={AXIS.left + position * slot} y={AXIS.top} width={slot} height={plotHeight} onPointerEnter={() => setActive(position)} onPointerDown={() => setActive(position)} />
                {position % labelEvery === 0 && <text className="vs-axis-text" x={x + barWidth / 2} y={height - 8} textAnchor="middle">{datum.axis}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      <DataTable caption={title} head={[tableHead, `${noun[0].toUpperCase()}${noun.slice(1)}s`]} rows={data.map((datum) => [datum.label, datum.value])} />
    </figure>
  );
}

export interface StepPoint {
  key: string;
  label: string;
  axis: string;
  living: number;
  werewolves: number;
  /** Who left at this point, for the readout. */
  detail: string;
}

/** Two step lines over the phases: players alive (neutral) and werewolves left (accent), with the latest point read out first. */
export function StepChart({ points, title }: { points: StepPoint[]; title: string }) {
  const { index, setActive, onKeyDown, reset } = useActivePoint(points.length, points.length - 1);
  const [plotRef, width] = useChartWidth();
  const height = 210;
  const top = niceMax(Math.max(1, ...points.map((point) => point.living)));
  const plotWidth = width - AXIS.left - AXIS.right;
  const plotHeight = height - AXIS.top - AXIS.bottom;
  const x = (position: number) => AXIS.left + (points.length > 1 ? (position / (points.length - 1)) * plotWidth : 0);
  const y = (value: number) => AXIS.top + plotHeight - (value / top) * plotHeight;
  const path = (read: (point: StepPoint) => number) => points.map((point, position) => (position === 0 ? `M${x(0)},${y(read(point))}` : `H${x(position)} V${y(read(point))}`)).join(' ');
  const labelEvery = labelStep(points.length, plotWidth);
  const slot = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;
  const active = points[index];
  const last = points.length - 1;
  return (
    <figure className="vs-chart">
      <figcaption className="vs-chart-title">{title}</figcaption>
      <ul className="vs-legend" aria-label="Legend">
        <li><span className="vs-key" aria-hidden="true" />Players alive</li>
        <li><span className="vs-key lead" aria-hidden="true" />Werewolves left</li>
      </ul>
      <p className="vs-readout" aria-live="polite">{active ? <><strong>{active.living} alive · {active.werewolves} {active.werewolves === 1 ? 'werewolf' : 'werewolves'} left</strong> · {active.label}{active.detail ? ` · ${active.detail}` : ''}</> : null}</p>
      <div className="vs-plot" ref={plotRef} tabIndex={0} role="group" aria-label={`${title}. Use the left and right arrow keys to read each point.`} onKeyDown={onKeyDown} onBlur={reset} onPointerLeave={(event) => { if (event.pointerType === 'mouse') reset(); }}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden="true">
          <Grid top={top} height={height} width={width} />
          <path className="vs-line" d={path((point) => point.living)} />
          <path className="vs-line lead" d={path((point) => point.werewolves)} />
          {[{ value: points[last]?.living ?? 0, lead: false }, { value: points[last]?.werewolves ?? 0, lead: true }].map((end) => (
            <circle key={String(end.lead)} className={`vs-dot${end.lead ? ' lead' : ''}`} cx={x(last)} cy={y(end.value)} r={4.5} />
          ))}
          {index !== last && <line className="vs-cursor" x1={x(index)} x2={x(index)} y1={AXIS.top} y2={AXIS.top + plotHeight} />}
          {points.map((point, position) => (
            <g key={point.key}>
              <rect className="vs-hit" x={x(position) - slot / 2} y={AXIS.top} width={slot} height={plotHeight} onPointerEnter={() => setActive(position)} onPointerDown={() => setActive(position)} />
              {position % labelEvery === 0 && <text className="vs-axis-text" x={x(position)} y={height - 8} textAnchor="middle">{point.axis}</text>}
            </g>
          ))}
        </svg>
      </div>
      <DataTable caption={title} head={['After', 'Players alive', 'Werewolves left']} rows={points.map((point) => [point.label, point.living, point.werewolves])} />
    </figure>
  );
}

export interface MatrixData {
  voters: Array<{ playerId: string; displayName: string }>;
  targets: Array<{ playerId: string; displayName: string }>;
  cells: Array<{ voter: number; target: number; votes: number }>;
  maxVotes: number;
}

/** Voters down the side, the players they voted for across the top. The number in each cell is how often. */
export function VoteMatrix({ matrix }: { matrix: MatrixData }) {
  const counts = new Map(matrix.cells.map((cell) => [`${cell.voter}:${cell.target}`, cell.votes]));
  const level = (votes: number) => {
    const share = votes / Math.max(matrix.maxVotes, 1);
    return share > 0.75 ? 4 : share > 0.5 ? 3 : share > 0.25 ? 2 : 1;
  };
  return (
    <div className="vs-matrix-scroll" tabIndex={0} role="group" aria-label="Who voted for whom. Scroll sideways to see every column.">
      <table className="vs-matrix">
        <caption className="sr-only">Votes each player cast for each other player across every published Day</caption>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Voter</span></th>
            {matrix.targets.map((target) => <th key={target.playerId} scope="col"><span className="vs-col-name" title={target.displayName}>{target.displayName}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {matrix.voters.map((voter, row) => (
            <tr key={voter.playerId}>
              <th scope="row">{voter.displayName}</th>
              {matrix.targets.map((target, column) => {
                const votes = counts.get(`${row}:${column}`) ?? 0;
                return votes > 0
                  ? <td key={target.playerId} className="vs-cell" data-level={level(votes)} title={`${voter.displayName} voted for ${target.displayName} ${plural(votes, 'time')}`}>{votes}</td>
                  : <td key={target.playerId} className="vs-cell empty"><span className="sr-only">0</span></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Section({ id, eyebrow, title, intro, children }: { id: string; eyebrow: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="vs-section" aria-labelledby={`${id}-title`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={`${id}-title`}>{title}</h2>
      {intro && <p className="vs-intro">{intro}</p>}
      {children}
    </section>
  );
}
