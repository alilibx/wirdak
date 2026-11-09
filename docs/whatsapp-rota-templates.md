# WhatsApp templates for rotating khatmas

The templates for messages Wirdak starts to a rota member or organizer, submitted to the "Wirdak" messaging account of the Manzilo business. Production and staging share them. The code is in `convex/lib/rotaTemplates.ts` (members) and `convex/lib/whatsappTemplates.ts` (`NOTE_TEMPLATES`, organizers).

## Rules for every template

- **Category:** UTILITY. **Language:** `ar`.
- Plain status updates only: no prayers, questions, invitations or footers. Meta read every one of those as MARKETING in the first rounds (see `docs/superpowers/specs/2026-10-29-wirdak-whatsapp-templates-design.md`, section 3.3). If Meta approves one as MARKETING anyway, reword it and submit it under a new name (a deleted template's name stays taken). Don't send it as marketing.
- **Link tracking off** on every URL button, so invite codes don't pass through Meta's tracker.
- The dua is never in a template. It goes out as free-form text inside the 24-hour window, or behind the «دعاء الختم» button of `wirdak_rota_complete`.
- Header: text, `{{1}}` = the khatma's title as the app shows it (at most 60 characters). Sample: `ختمة العائلة`.
- Quick-reply buttons carry a payload per send (`r1|<p or s>|<action>|<dayId>|<participantId>`), so their labels are fixed here and the payloads are not part of the submission.
- A body can't end with a placeholder, even with a full stop after it, so real words follow the last `{{n}}`.
- `wirdak_rota_juz`, `wirdak_rota_assigned` and `wirdak_rota_covered` were moved to MARKETING on review, so their `_v2` templates replace them. Never send the originals.
- Sample values are the examples Meta asks for.
- Numbers are Western digits (`5`, `30`), never Eastern Arabic (`٥`, `٣٠`). The approved `wirdak_rota_summary` still has `٣٠` in its fixed text, so it reads «24 من ٣٠» until `wirdak_rota_summary_v2` (the same body with `30`) is approved and the code moves to it.
- `wirdak_rota_juz_v3` (one juz') and `wirdak_rota_juz_many` (two or more) replace `wirdak_rota_juz_v2` once approved. Their parameter is the juz' numbers only (`4`, `4 و5`), and the khatma number is gone. Until then, `_v2` keeps sending. Inside the 24-hour window the free-form text already uses the new wording.

## Messages to members

All have header `{{1}}` and quick-reply buttons only.

| Name | Body | Body samples | Buttons |
| --- | --- | --- | --- |
| `wirdak_rota_juz_v2` | `تحديث على قراءتك اليوم في الختمة {{1}}: المسجَّل لك {{2}} من هذه الختمة.` | `3`, `الجزآن 5 و6` | «أتممت», «ليس بعد» |
| `wirdak_rota_juz_v3` (pending, 2026-11-09) | `السلام عليكم، جزؤكم اليوم هو {{1}}. انقروا «أتممت» بعد القراءة.` | `4` | «أتممت», «ليس بعد» |
| `wirdak_rota_juz_many` (pending, 2026-11-09) | `السلام عليكم، أجزاؤكم اليوم هي {{1}}. انقروا «أتممت» بعد القراءة.` | `4 و5` | «أتممت», «ليس بعد» |
| `wirdak_rota_reminder` | `تذكير بقراءتك اليوم: لم تُسجَّل بعد قراءة {{1}} في هذه الختمة.` | `الجزأين 5 و6` | «أتممت», «ليس بعد» |
| `wirdak_rota_assigned_v2` | `تحديث على قراءتك: سُجِّلت لك قراءة {{1}} في الختمة {{2}} لهذا اليوم.` | `الأجزاء 3، 5 و6`, `7` | «أتممت», «ليس بعد» |
| `wirdak_rota_covered_v2` | `تحديث على قراءتك: سُجِّلت اليوم قراءة {{1}} باسم قارئ آخر في هذه الختمة.` | `الجزء 26` | none |
| `wirdak_rota_complete` | `تحديث على الختمة: اكتملت قراءة الأجزاء الثلاثين في الختمة {{1}} لهذا اليوم.` | `30` | «دعاء الختم» |
| `wirdak_rota_cycle` | `تحديث على قراءتك: أكملت ثلاثين جزءاً في ثلاثين ختمة، أي القرآن كاملاً.` | none | none |

The juz' text is `الجزء 26` for one juz', `الجزآن 5 و6` for two and `الأجزاء 3، 5 و6` for three or more. It is the subject of `wirdak_rota_juz_v2` only. Everywhere else it follows the noun «قراءة» (the singular feminine subject, so the verb never has to agree with a plural), so it is genitive: the same except `الجزأين 5 و6` for two. This applies to `wirdak_rota_unread` too.

For a juz' two readers share, the juz' phrase may carry a partner note right after its number, such as «الجزء 26 (مشترك مع فلان)»; it is still one parameter, so no template changes. The free-form juz' text inside the window carries it the same way («جزؤكم اليوم هو 26 (مشترك مع فلان)»), and so would the numbers-only parameter of `wirdak_rota_juz_v3` and `wirdak_rota_juz_many` (`juzList` with partners).

## Messages to the organizer

Header `{{1}}` and one URL button, «افتح الختمة», to `https://wirdak.app/{{1}}` (button sample: `j/AB12CD`; staging sends `stg/j/<code>`).

| Name | Body | Body samples |
| --- | --- | --- |
| `wirdak_rota_unread` | `تحديث على الختمة التي تنظّمها: لم تُسجَّل بعد قراءة {{1}} في ختمة اليوم.` | `الجزأين 5 و6` |
| `wirdak_rota_summary` | `تحديث على الختمة التي تنظّمها: تمّت قراءة {{1}} من ٣٠ جزءاً اليوم.` | `24` |
| `wirdak_rota_summary_v2` (pending, 2026-11-09) | `تحديث على الختمة التي تنظّمها: تمّت قراءة {{1}} من 30 جزءاً اليوم.` | `24` |
| `wirdak_rota_join_request` | `تحديث على الختمة التي تنظّمها: وصل من {{1}} طلب انضمام جديد.` | `أحمد` |

The organizer notes `rotaSilent`, `rotaSilenced` and `rotaStopped`, and `rotaEnabled` (the note that tells someone rotating khatmas are on for them, an announcement Meta would read as marketing), have no template: in-app and push only.
