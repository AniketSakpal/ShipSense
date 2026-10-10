
const IST_OFFSET_MINUTES = 330;

export function getNotificationTime(
  requestedAt: Date
): Date {
  const istMillis =
    requestedAt.getTime() + IST_OFFSET_MINUTES * 60_000;

  const ist = new Date(istMillis);
  const hour = ist.getUTCHours();

  // Allowed customer-contact window: 08:00 through 20:59 IST.
  if (hour >= 8 && hour < 21) {
    return requestedAt;
  }

  const nextMorning = new Date(istMillis);

  if (hour >= 21) {
    nextMorning.setUTCDate(nextMorning.getUTCDate() + 1);
  }

  nextMorning.setUTCHours(8, 0, 0, 0);

  return new Date(
    nextMorning.getTime() - IST_OFFSET_MINUTES * 60_000
  );
}
