export type AssistantInlineToken = {
  type: 'text' | 'bold' | 'italic' | 'code';
  value: string;
};

// Marcas mínimas que usa el modelo: **negrita**, *cursiva* y `código`.
export const parseAssistantInline = (text: string): AssistantInlineToken[] => {
  const tokens: AssistantInlineToken[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  let lastIndex = 0;

  for (const match of String(text || '').matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) tokens.push({ type: 'text', value: text.slice(lastIndex, index) });
    const raw = match[0];
    if (raw.startsWith('**')) tokens.push({ type: 'bold', value: raw.slice(2, -2) });
    else if (raw.startsWith('`')) tokens.push({ type: 'code', value: raw.slice(1, -1) });
    else tokens.push({ type: 'italic', value: raw.slice(1, -1) });
    lastIndex = index + raw.length;
  }

  if (lastIndex < String(text || '').length) tokens.push({ type: 'text', value: text.slice(lastIndex) });
  return tokens.filter((token) => token.value.length > 0);
};

export type AssistantBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'table'; lines: string[] }
  | { type: 'divider' };

export const parseAssistantMarkdown = (text: string): AssistantBlock[] => {
  const blocks: AssistantBlock[] = [];
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
      list = null;
    }
  };
  const flushTable = () => {
    if (table.length > 0) {
      blocks.push({ type: 'table', lines: table });
      table = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushAll();
      continue;
    }

    if (/^\|.*\|$/.test(trimmed)) {
      flushParagraph();
      flushList();
      table.push(trimmed);
      continue;
    }
    flushTable();

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushAll();
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll();
      blocks.push({ type: 'divider' });
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1].trim());
      continue;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1].trim());
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushAll();
      blocks.push({ type: 'quote', text: quote[1].trim() });
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushAll();
  return blocks;
};
