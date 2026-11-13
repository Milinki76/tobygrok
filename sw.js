// Service worker stub for web push (plan B: no POST endpoint, Telegram/webpush only if subscribed later)
self.addEventListener('push', event => {
  // handle later
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
});
