# Wirdak cheer notes design

- **Status:** Built with ARQ-307
- **Builds on:** the plan 2 spec (`2026-10-28-wirdak-plan2-design.md`) and the rotating khatma spec (`2026-10-29-wirdak-rotating-khatma-design.md`)

## Intent

When someone finishes a juz', the people still reading hear that the khatma is moving. It's encouragement, so it must never read as pressure.

## Decisions

Ali asked for the feature, an admin setting for who gets it and how often, and a per-khatma override. Every choice below is the builder's call.

- **Nameless by default, and the organizer decides (Ali).** The plan 2 anti-goals say notes are never sent to the group about one person, and finished ajza' show no names. So by default a cheer gives only the round's count, and it leaves out the juz' number too, because the tile showed who held it. Ali chose to leave this to each khatma: `showName` and `showJuz` put the reader's name and the juz' number in the cheer. Both are off unless an admin default or the organizer turns them on. This is the one place that lifts those anti-goals, and only for a khatma that asks.
- **Audience.** "Still reading" means holding a juz' that hasn't finished: a pool hold, or a rota read for today that isn't done. A hold opened for help doesn't count, because that reader has already been asked to let someone help. The "everyone" setting reaches every member but the reader who finished.
- **How often.** A gap per person in each khatma, 24 hours by default. A gap of zero cheers on every finish. A new cheer replaces the one showing, on the page and on the device. WhatsApp can't replace a message, so a rota khatma with a gap of zero sends one per read.
- **Not a nudge.** A cheer doesn't touch `lastNudgeAt`, so it can't suppress a reminder, which only fires once. A nudge in the last `nudgeCooldownMs`, an "almost up" note on the reader's hold, a rota day's reminder, or a «ليس بعد» answer holds a cheer back. A reminder can still follow a cheer the same day.
- **No pointing.** The last two ajza' of a round or day go uncheered: a count of 29 of 30 sent to the one person still reading would tell them they're being waited for. The completion message covers the end.
- **Timing.** A cheer waits out `undoWindowMs`, so a mistaken tap tells nobody. A cheer clears when its reader finishes, steps back, or has their hold opened for help, and when the round ends. Rota cheers stop while the khatma is paused and once the open day is yesterday's, as reminders do.
- **Settings.** `cheerOn`, `cheerEveryone`, `cheerGapMs`, `cheerShowName`, and `cheerShowJuz` are the admin defaults. `khatmas.cheer` is the khatma's own choice, set by its organizer or, on a rota khatma, by an admin helping out. A pool khatma has no admin settings screen, so only its organizer can set it. Missing means the defaults, so a change to the defaults reaches every khatma that hasn't chosen.

## Channels

- **Pool khatmas:** the in-app note and push, with no WhatsApp message. Meta counts encouragement as marketing, like the `behind` invite.
- **Rota khatmas:** participants are mostly on WhatsApp alone, so a cheer is a free-form message to phones inside their 24-hour window. There is no template. Quiet hours drop a rota cheer instead of holding it, because it would be stale by morning.

A rota cheer doesn't reach anyone who hasn't written in the last 24 hours. Reaching them would need a template billed as marketing, for every participant, for each cheer.
