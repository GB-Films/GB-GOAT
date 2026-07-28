export const buildPaymentAuditAppend = (paymentAuthorIds: unknown, currentUserId: string) => ({
  paymentLocked: true,
  paymentAuthorIds: [
    ...(Array.isArray(paymentAuthorIds)
      ? paymentAuthorIds.filter((authorId): authorId is string => typeof authorId === 'string' && Boolean(authorId))
      : []),
    currentUserId,
  ],
});
