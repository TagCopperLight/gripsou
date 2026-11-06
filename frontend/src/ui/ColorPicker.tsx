import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { FloatingPanel } from "./FloatingPanel";
import { hexToHsv, hsvToHex, type Hsv } from "../lib/color";

const HEX6 = /^#[0-9a-f]{6}$/;
const WIDTH = 240;

type ColorPickerProps = {
  value: string;
  onChange: (color: string) => void;
  /** The swatch that opened it: the panel hangs under it, right-aligned. */
  anchor: HTMLElement;
  onClose: () => void;
};

/** A colour area, a hue slider and the hex code, in a small panel under the
 *  swatch that opened it. Ours rather than the system's picker: that one is a
 *  separate window the page can't close, so it would outlive the window it was
 *  opened from. */
export function ColorPicker({ value, onChange, anchor, onClose }: ColorPickerProps) {
  const { t } = useTranslation();
  // Kept apart from `value`: a grey or black has no hue of its own, and the
  // slider must not jump back to red when the area reaches one.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(HEX6.test(value) ? value : "#000000"));
  const [hex, setHex] = useState(value.replace("#", ""));
  const canvas = useRef<HTMLCanvasElement>(null);
  const shade = useRef<HTMLDivElement>(null);

  const pick = (next: Hsv) => {
    setHsv(next);
    const color = hsvToHex(next);
    setHex(color.slice(1));
    onChange(color);
  };

  // Drawn on a canvas: CSS gradients layered over a background colour leave
  // a thin line of the hue at the rounded corners.
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const { width, height } = ctx.canvas;
    ctx.fillStyle = hsvToHex({ h: hsv.h, s: 1, v: 1 });
    ctx.fillRect(0, 0, width, height);
    const white = ctx.createLinearGradient(0, 0, width, 0);
    white.addColorStop(0, "#fff");
    white.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, width, height);
    const black = ctx.createLinearGradient(0, 0, 0, height);
    black.addColorStop(0, "rgba(0,0,0,0)");
    black.addColorStop(1, "#000");
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, width, height);
  }, [hsv.h]);

  /** Follows the pointer from a press until it's released, even outside. */
  const track = (apply: (x: number, y: number) => void) => (e: PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    const move = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      const clamp = (n: number) => Math.min(1, Math.max(0, n));
      apply(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height));
    };
    move(e);
    el.onpointermove = move;
    el.onpointerup = () => (el.onpointermove = null);
  };

  /** Arrow keys for a slider: a 1 % step, 10 % with Shift. */
  const keys = (axis: "x" | "y" | "both", apply: (dx: number, dy: number) => void) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = d[e.key];
    if (!move) return;
    if (axis === "x" && move[0] === 0) return;
    e.preventDefault();
    apply(move[0], move[1]);
  };
  const clamp = (n: number) => Math.min(1, Math.max(0, n));

  return (
    <FloatingPanel
      anchor={anchor}
      onClose={onClose}
      align="end"
      initialFocus={shade}
      style={{ width: WIDTH }}
      className="flex flex-col gap-2.5 rounded-2xl bg-surface-2 p-3 shadow-lg"
    >
      <div
        ref={shade}
        role="slider"
        tabIndex={0}
        aria-label={t("common.colorPicker.shade")}
        aria-valuetext={`${Math.round(hsv.s * 100)} %, ${Math.round(hsv.v * 100)} %`}
        onPointerDown={track((x, y) => pick({ ...hsv, s: x, v: 1 - y }))}
        onKeyDown={keys("both", (dx, dy) => pick({ ...hsv, s: clamp(hsv.s + dx), v: clamp(hsv.v - dy) }))}
        className="relative h-37.5 cursor-crosshair touch-none rounded-[10px] outline-none ring-inset focus-visible:ring-1 focus-visible:ring-green"
      >
        <canvas ref={canvas} width={WIDTH} height={150} className="size-full rounded-[10px]" />
        <span
          className="pointer-events-none absolute size-3 -translate-1/2 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.35)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
        />
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label={t("common.colorPicker.hue")}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={track((x) => pick({ ...hsv, h: x * 359.9 }))}
        onKeyDown={keys("x", (dx) => pick({ ...hsv, h: clamp(hsv.h / 360 + dx) * 359.9 }))}
        className="relative h-3 cursor-pointer touch-none rounded-full outline-none ring-inset focus-visible:ring-1 focus-visible:ring-green"
        style={{ background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}
      >
        <span
          className="pointer-events-none absolute top-1/2 h-4.5 w-1.5 -translate-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.4)]"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>
      <label className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[13px] text-fg-dim">
        <span className="size-4.5 shrink-0 rounded-[5px]" style={{ background: hsvToHex(hsv) }} />
        #
        <input
          aria-label={t("common.colorPicker.hex")}
          value={hex}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            const raw = e.target.value.replace("#", "").toLowerCase();
            setHex(raw);
            if (HEX6.test(`#${raw}`)) {
              setHsv(hexToHsv(`#${raw}`));
              onChange(`#${raw}`);
            }
          }}
          className="w-full bg-transparent text-fg outline-none"
        />
      </label>
    </FloatingPanel>
  );
}
