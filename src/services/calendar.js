export async function getAvailableSlots({ location }) {
  // Placeholder for Google Calendar, Calendly, or a custom admin scheduling API.
  // In production, query live availability and filter by team coverage/location.
  const base = nextBusinessDays(5);
  return base.slice(0, 3).flatMap((date) => [
    {
      id: `${date}-09`,
      label: `${date} at 09:00`,
      startsAt: `${date}T09:00:00+02:00`,
      location
    },
    {
      id: `${date}-13`,
      label: `${date} at 13:00`,
      startsAt: `${date}T13:00:00+02:00`,
      location
    }
  ]);
}

export async function holdSlot({ userId, slot }) {
  // Placeholder for a temporary calendar hold. Replace with real calendar event
  // creation using a short expiry if your provider supports it.
  return {
    holdId: `hold-${userId}-${slot.id}`,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  };
}

function nextBusinessDays(count) {
  const days = [];
  const date = new Date();

  while (days.length < count) {
    date.setDate(date.getDate() + 1);
    const weekday = date.getDay();
    if (weekday !== 0) {
      days.push(date.toISOString().slice(0, 10));
    }
  }

  return days;
}
