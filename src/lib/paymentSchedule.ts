export type PaymentScheduleView = 'week' | 'month';

export interface PaymentScheduleLine {
  id: string;
  projectId?: string;
  projectName?: string;
  area: string;
  providerName: string;
  description: string;
  total: number;
  paid: number;
  debt: number;
  paymentDate?: any;
  source?: string;
}

export interface PaymentScheduleBucket {
  key: string;
  label: string;
  shortLabel: string;
  start: Date;
  end: Date;
  total: number;
  count: number;
  lines: PaymentScheduleLine[];
  isToday: boolean;
}

export const startOfLocalDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const parseScheduleDate = (dateValue: any): Date | null => {
  if (!dateValue) return null;

  if (typeof dateValue === 'string') {
    const value = dateValue.trim();
    if (!value) return null;
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00`)
      : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : startOfLocalDay(parsed);
  }

  if (dateValue.seconds) {
    const parsed = new Date(dateValue.seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : startOfLocalDay(parsed);
  }

  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime()) ? null : startOfLocalDay(parsed);
};

export const formatDateKey = (dateValue: any) => {
  const date = parseScheduleDate(dateValue) || startOfLocalDay(new Date());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const formatScheduleDate = (dateValue: any, options?: Intl.DateTimeFormatOptions) => {
  const date = parseScheduleDate(dateValue);
  if (!date) return 'Sin fecha';
  return date.toLocaleDateString('es-AR', options || { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const startOfWeek = (dateValue: any) => {
  const date = parseScheduleDate(dateValue) || startOfLocalDay(new Date());
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(date, mondayOffset);
};

export const endOfWeek = (dateValue: any) => addDays(startOfWeek(dateValue), 6);

export const getPeriodRange = (anchorValue: any, view: PaymentScheduleView) => {
  const anchor = parseScheduleDate(anchorValue) || startOfLocalDay(new Date());

  if (view === 'month') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { start, end };
  }

  return { start: startOfWeek(anchor), end: endOfWeek(anchor) };
};

export const linePaymentDate = (line: PaymentScheduleLine) => parseScheduleDate(line.paymentDate);

export const getLinesInRange = (lines: PaymentScheduleLine[], start: Date, end: Date) => (
  lines.filter((line) => {
    const date = linePaymentDate(line);
    if (!date) return false;
    return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
  })
);

export const sumDebt = (lines: PaymentScheduleLine[]) => (
  lines.reduce((acc, line) => acc + Math.max(0, Number(line.debt) || 0), 0)
);

export const getOverdueLines = (lines: PaymentScheduleLine[], todayValue: any = new Date()) => {
  const today = parseScheduleDate(todayValue) || startOfLocalDay(new Date());
  return lines.filter((line) => {
    const date = linePaymentDate(line);
    return date && date.getTime() < today.getTime() && (Number(line.debt) || 0) > 0.01;
  });
};

export const getUnscheduledLines = (lines: PaymentScheduleLine[]) => (
  lines.filter((line) => !linePaymentDate(line) && (Number(line.debt) || 0) > 0.01)
);

export const getTodayLines = (lines: PaymentScheduleLine[], todayValue: any = new Date()) => {
  const today = parseScheduleDate(todayValue) || startOfLocalDay(new Date());
  return lines.filter((line) => {
    const date = linePaymentDate(line);
    return date && date.getTime() === today.getTime() && (Number(line.debt) || 0) > 0.01;
  });
};

const buildWeekBucketsForMonth = (anchorValue: any) => {
  const { start, end } = getPeriodRange(anchorValue, 'month');
  const buckets: Array<{ start: Date; end: Date }> = [];
  let cursor = startOfWeek(start);

  while (cursor.getTime() <= end.getTime()) {
    const bucketStart = new Date(Math.max(cursor.getTime(), start.getTime()));
    const naturalEnd = addDays(cursor, 6);
    const bucketEnd = new Date(Math.min(naturalEnd.getTime(), end.getTime()));
    buckets.push({ start: bucketStart, end: bucketEnd });
    cursor = addDays(cursor, 7);
  }

  return buckets;
};

export const buildPaymentBuckets = (
  lines: PaymentScheduleLine[],
  anchorValue: any,
  view: PaymentScheduleView,
): PaymentScheduleBucket[] => {
  const today = startOfLocalDay(new Date());
  const ranges = view === 'week'
    ? Array.from({ length: 7 }, (_, index) => {
        const start = addDays(startOfWeek(anchorValue), index);
        return { start, end: start };
      })
    : buildWeekBucketsForMonth(anchorValue);

  return ranges.map((range, index) => {
    const bucketLines = getLinesInRange(lines, range.start, range.end);
    const isSingleDay = range.start.getTime() === range.end.getTime();
    const label = isSingleDay
      ? formatScheduleDate(range.start, { weekday: 'short', day: '2-digit', month: '2-digit' })
      : `${formatScheduleDate(range.start, { day: '2-digit', month: '2-digit' })} - ${formatScheduleDate(range.end, { day: '2-digit', month: '2-digit' })}`;

    return {
      key: `${formatDateKey(range.start)}_${formatDateKey(range.end)}_${index}`,
      label,
      shortLabel: view === 'week'
        ? formatScheduleDate(range.start, { weekday: 'short' })
        : `Sem ${index + 1}`,
      start: range.start,
      end: range.end,
      total: sumDebt(bucketLines),
      count: bucketLines.length,
      lines: bucketLines.sort((a, b) => a.providerName.localeCompare(b.providerName, 'es')),
      isToday: today.getTime() >= range.start.getTime() && today.getTime() <= range.end.getTime(),
    };
  });
};

export const formatPeriodLabel = (anchorValue: any, view: PaymentScheduleView) => {
  const { start, end } = getPeriodRange(anchorValue, view);
  if (view === 'month') {
    return formatScheduleDate(start, { month: 'long', year: 'numeric' });
  }
  return `${formatScheduleDate(start, { day: '2-digit', month: '2-digit' })} - ${formatScheduleDate(end, { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
};
