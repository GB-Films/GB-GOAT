import { useRef } from "react";
export function PortalSignatureCanvas({
  onChange,
}: {
  onChange: (value: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false),
    ink = useRef(false);
  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (ink.current && canvas.current) onChange(canvas.current.toDataURL("image/png"));
  };
  return (
    <div>
      <canvas
        ref={canvas}
        width={600}
        height={300}
        aria-label="Dibujá tu firma"
        className="h-auto w-full touch-none rounded-lg border bg-white"
        onPointerDown={(e) => {
          const c = canvas.current;
          if (!c) return;
          const ctx = c.getContext("2d")!;
          const r = c.getBoundingClientRect();
          drawing.current = true;
          ink.current = false;
          c.setPointerCapture(e.pointerId);
          ctx.beginPath();
          ctx.moveTo(
            ((e.clientX - r.left) * c.width) / r.width,
            ((e.clientY - r.top) * c.height) / r.height,
          );
        }}
        onPointerMove={(e) => {
          const c = canvas.current;
          if (!c || !drawing.current) return;
          const r = c.getBoundingClientRect(),
            ctx = c.getContext("2d")!;
          ctx.lineWidth = 2.5;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#0f172a";
          ctx.lineTo(
            ((e.clientX - r.left) * c.width) / r.width,
            ((e.clientY - r.top) * c.height) / r.height,
          );
          ctx.stroke();
          ink.current = true;
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
      <button
        type="button"
        className="mt-1 text-sm underline"
        onClick={() => {
          const c = canvas.current;
          c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
          drawing.current = false;
          ink.current = false;
          onChange("");
        }}
      >
        Borrar firma
      </button>
    </div>
  );
}
