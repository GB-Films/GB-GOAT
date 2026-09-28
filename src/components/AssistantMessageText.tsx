import { useMemo } from 'react';
import { cn } from '../lib/utils';
import { parseAssistantInline, parseAssistantMarkdown } from '../lib/assistantMarkdown';

function Inline({ text }: { text: string }) {
  const tokens = useMemo(() => parseAssistantInline(text), [text]);
  return (
    <>
      {tokens.map((token, index) => {
        if (token.type === 'bold') return <strong key={index} className="font-black">{token.value}</strong>;
        if (token.type === 'italic') return <em key={index}>{token.value}</em>;
        if (token.type === 'code') {
          return (
            <code key={index} className="rounded bg-slate-200/80 px-1 py-0.5 font-mono text-[10.5px] text-slate-700">
              {token.value}
            </code>
          );
        }
        return <span key={index}>{token.value}</span>;
      })}
    </>
  );
}

// Render chico de markdown para las respuestas del asistente: encabezados,
// listas, citas, negritas, código y tablas simples (en bloque monoespaciado).
export function AssistantMessageText({ text }: { text: string }) {
  const blocks = useMemo(() => parseAssistantMarkdown(text), [text]);

  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <p
              key={index}
              className={cn(
                'font-black uppercase tracking-widest text-slate-500',
                block.level === 1 ? 'text-[11px]' : 'text-[10px]',
              )}
            >
              <Inline text={block.text} />
            </p>
          );
        }
        if (block.type === 'list') {
          return block.ordered
            ? (
              <ol key={index} className="ml-4 list-decimal space-y-1 marker:text-slate-400">
                {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)}
              </ol>
            )
            : (
              <ul key={index} className="ml-4 list-disc space-y-1 marker:text-slate-400">
                {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)}
              </ul>
            );
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={index} className="border-l-2 border-slate-300 pl-2 italic text-slate-600">
              <Inline text={block.text} />
            </blockquote>
          );
        }
        if (block.type === 'divider') return <hr key={index} className="border-slate-200" />;
        if (block.type === 'table') {
          return (
            <pre key={index} className="overflow-x-auto rounded bg-slate-200/60 p-2 font-mono text-[10px] leading-4 text-slate-700">
              {block.lines.join('\n')}
            </pre>
          );
        }
        return <p key={index}><Inline text={block.text} /></p>;
      })}
    </div>
  );
}
