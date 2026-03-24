// Schedule local notifications for Sunday Money Date reminders
// Uses the Notification API (no push server needed for local reminders)

export function getNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission; // "granted", "denied", or "default"
}

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  return await Notification.requestPermission();
}

export function scheduleSundayReminder() {
  if (getNotificationPermission() !== "granted") return;

  const now = new Date();
  const sunday = new Date(now);
  // Find next Sunday at 10:00 AM
  sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7 || 7));
  sunday.setHours(10, 0, 0, 0);

  // If it's Sunday and before 10am, use today
  if (now.getDay() === 0 && now.getHours() < 10) {
    sunday.setDate(now.getDate());
  }

  const ms = sunday.getTime() - now.getTime();
  if (ms <= 0) return;

  // Store the scheduled time so we don't double-schedule
  const lastScheduled = localStorage.getItem("bp_reminder_scheduled");
  const sundayKey = sunday.toISOString().split("T")[0];
  if (lastScheduled === sundayKey) return;

  localStorage.setItem("bp_reminder_scheduled", sundayKey);

  setTimeout(() => {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification("Budget Planner", {
          body: "It's Sunday Money Date time! 📅 Log expenses, check goals, move leftover to HYSA.",
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: "money-date-reminder",
        });
      });
    } else {
      new Notification("Budget Planner", {
        body: "It's Sunday Money Date time! 📅 Log expenses, check goals, move leftover to HYSA.",
        icon: "/icons/icon-192.png",
      });
    }
    // Re-schedule for next week
    localStorage.removeItem("bp_reminder_scheduled");
    scheduleSundayReminder();
  }, ms);
}
