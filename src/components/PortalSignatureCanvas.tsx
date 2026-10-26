import { useRef } from "react";
export function PortalSignatureCanvas({
  onChange,
}: {
  onChange: (value: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false);
  return (
    <div>
      <canvas
        ref={canvas}
        width={600}
        height={160}
        aria-label="Dibujá tu firma"
        className="h-32 w-full touch-none rounded-lg border bg-white"
        onPointerDown={(e) => {
          const c = canvas.current;
          if (!c) return;
          const ctx = c.getContext("2d")!;
          const r = c.getBoundingClientRect();
          drawing.current = true;
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
        }}
        onPointerUp={() => {
          if (drawing.current && canvas.current) {
            drawing.current = false;
            onChange(canvas.current.toDataURL("image/png"));
          }
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <button
        type="button"
        className="mt-1 text-sm underline"
        onClick={() => {
          const c = canvas.current;
          c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
          onChange("");
        }}
      >
        Borrar firma
      </button>
    </div>
  );
}
