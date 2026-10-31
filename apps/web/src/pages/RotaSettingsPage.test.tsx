import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { RotaSettingsPage } from "./RotaSettingsPage";

const m = vi.hoisted(() => ({
  settings: undefined as unknown,
  fns: {
    update: vi.fn(),
    setPaused: vi.fn(),
    addPauseDate: vi.fn(),
    removePauseDate: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
  },
  startAgain: vi.fn(),
}));

vi.mock("../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
  clearSessionToken: () => {},
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: () => m.settings,
    useMutation: (ref: never) =>
      m.fns[getFunctionName(ref).split(":")[1] as keyof typeof m.fns],
    useAction: () => m.startAgain,
  };
});

const baseSettings = {
  name: "ختمة العائلة",
  days: { kind: "daily" },
  firstDate: "2026-10-30",
  firstDatePassed: true,
  endDate: null,
  timeZone: "Asia/Dubai",
  messages: {
    dayAt: 480,
    reminder: { at: 960, on: true },
    unread: { at: 1140, on: true },
    summary: { at: 1260, on: false },
  },
  pausedAt: null,
  pauseDates: ["2026-11-27"],
  upcoming: ["2026-11-27", "2026-11-28", "2026-11-29"],
  quiet: { startHour: 22, endHour: 7 },
  cheer: {
    override: null,
    defaults: {
      on: true,
      everyone: false,
      gapMs: 86_400_000,
      showName: false,
      showJuz: false,
    },
  },
  archived: false,
};

function Landing() {
  return <p>landed {useLocation().pathname}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/j/CODE/settings"]}>
      <Routes>
        <Route path="/j/:inviteCode/settings" element={<RotaSettingsPage />} />
        <Route path="/j/:inviteCode" element={<Landing />} />
        <Route path="/j/:inviteCode/setup" element={<Landing />} />
        <Route path="/" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

const args = { sessionToken: "tok", inviteCode: "CODE" };
const section = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  // Thursday 29 October 2026, UTC.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T08:00:00Z"));
  for (const fn of Object.values(m.fns)) {
    fn.mockReset().mockResolvedValue({ ok: true });
  }
  m.startAgain.mockReset().mockResolvedValue({ inviteCode: "NEWCODE" });
  m.settings = structuredClone(baseSettings);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("RotaSettingsPage", () => {
  it("links back to the khatma", () => {
    renderPage();
    expect(
      screen.getByRole("link", { name: t.organizer.back }),
    ).toHaveAttribute("href", "/j/CODE");
  });

  it("waits for the settings, and sends anyone else back to the khatma", () => {
    m.settings = undefined;
    const { unmount } = renderPage();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    unmount();
    m.settings = null;
    renderPage();
    expect(screen.getByText("landed /j/CODE")).toBeInTheDocument();
  });

  describe("pausing", () => {
    it("the switch pauses the khatma now", async () => {
      const user = userEvent.setup();
      renderPage();
      const pause = screen.getByRole("switch", { name: t.rota.pauseNow });
      expect(pause).toHaveAttribute("aria-checked", "false");
      expect(screen.getByText(t.rota.pauseHint)).toBeInTheDocument();
      await user.click(pause);
      expect(m.fns.setPaused).toHaveBeenCalledWith({ ...args, paused: true });
    });

    it("shows a paused khatma switched on, and the switch resumes it", async () => {
      m.settings = { ...baseSettings, pausedAt: 5 };
      const user = userEvent.setup();
      renderPage();
      const pause = screen.getByRole("switch", { name: t.rota.pauseNow });
      expect(pause).toHaveAttribute("aria-checked", "true");
      await user.click(pause);
      expect(m.fns.setPaused).toHaveBeenCalledWith({ ...args, paused: false });
    });

    it("lists the paused dates as chips that remove themselves", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(
        screen.getByRole("button", { name: "احذف الجمعة ٢٧ نوفمبر" }),
      );
      expect(m.fns.removePauseDate).toHaveBeenCalledWith({
        ...args,
        date: "2026-11-27",
      });
    });

    it("«+ تاريخ» offers the upcoming reading days that are not paused yet", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole("button", { name: t.rota.addDate }));
      const sheet = screen.getByRole("dialog", { name: t.rota.pickDateTitle });
      expect(
        within(sheet)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual([t.sheet.close, "السبت ٢٨ نوفمبر", "الأحد ٢٩ نوفمبر"]);
      await user.click(
        within(sheet).getByRole("button", { name: "السبت ٢٨ نوفمبر" }),
      );
      expect(m.fns.addPauseDate).toHaveBeenCalledWith({
        ...args,
        date: "2026-11-28",
      });
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("says when there is no day left to pause", async () => {
      m.settings = { ...baseSettings, upcoming: [] };
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole("button", { name: t.rota.addDate }));
      expect(screen.getByText(t.rota.noUpcoming)).toBeInTheDocument();
    });

    it("shows why a date was refused", async () => {
      m.fns.addPauseDate.mockResolvedValue({ error: "past" });
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole("button", { name: t.rota.addDate }));
      await user.click(screen.getByRole("button", { name: "السبت ٢٨ نوفمبر" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.rota.errors.past ?? "",
      );
    });
  });

  describe("message times", () => {
    it("shows the four messages with their times; the first has no switch", () => {
      renderPage();
      const messages = section(t.rota.messagesHeading);
      const times = within(messages).getAllByLabelText(t.rota.timeLabel);
      // The summary is off, and still shows its time.
      expect(times.map((el) => (el as HTMLSelectElement).value)).toEqual([
        "480",
        "960",
        "1140",
        "1260",
      ]);
      expect(
        within(messages)
          .getAllByRole("switch")
          .map((s) => s.getAttribute("aria-checked")),
      ).toEqual(["true", "true", "false"]);
      expect(within(messages).getByText(t.rota.locked)).toBeInTheDocument();
      expect(
        within(messages).getByText("بتوقيت الختمة، بين ٧:٠٠ ص و٩:٤٥ م."),
      ).toBeInTheDocument();
    });

    it("offers quarter hours between the quiet hours only", () => {
      renderPage();
      const select = within(section(t.rota.messagesHeading)).getAllByLabelText(
        t.rota.timeLabel,
      )[0] as HTMLSelectElement;
      const values = Array.from(select.options).map((o) => Number(o.value));
      expect(values[0]).toBe(420);
      expect(values.at(-1)).toBe(1305);
      expect(values).toHaveLength(60);
      expect(values.every((v) => v % 15 === 0)).toBe(true);
    });

    const timeFields = () =>
      within(section(t.rota.messagesHeading)).getAllByLabelText(
        t.rota.timeLabel,
      ) as HTMLSelectElement[];
    it("saves the khatma's own cheer settings beside the messages", async () => {
      const user = userEvent.setup();
      renderPage();
      const cheerSection = section(t.cheer.heading);
      expect(cheerSection).toHaveTextContent(t.cheer.rotaHint);
      await user.click(
        within(cheerSection).getByRole("switch", {
          name: t.cheer.switchLabel,
        }),
      );
      await user.click(
        within(cheerSection).getByRole("button", { name: t.organizer.save }),
      );
      expect(m.fns.update).toHaveBeenCalledWith({
        ...args,
        cheer: {
          on: false,
          everyone: false,
          gapMs: 86_400_000,
          showName: false,
          showJuz: false,
        },
      });
    });

    const saveTimes = () =>
      within(section(t.rota.messagesHeading)).getByRole("button", {
        name: t.rota.saveTimes,
      });

    it("saves nothing until the button is pressed, and the button waits for a change", async () => {
      const user = userEvent.setup();
      renderPage();
      expect(saveTimes()).toBeDisabled();
      await user.selectOptions(timeFields()[1] as HTMLSelectElement, "1020");
      expect(m.fns.update).not.toHaveBeenCalled();
      expect(saveTimes()).toBeEnabled();
      await user.click(saveTimes());
      expect(m.fns.update).toHaveBeenCalledTimes(1);
      expect(m.fns.update).toHaveBeenCalledWith({
        ...args,
        messages: {
          ...baseSettings.messages,
          reminder: { at: 1020, on: true },
        },
      });
      await waitFor(() =>
        expect(
          within(section(t.rota.messagesHeading)).getByRole("status"),
        ).toHaveTextContent(t.organizer.saved),
      );
    });

    it("changing a time back leaves nothing to save", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.selectOptions(timeFields()[1] as HTMLSelectElement, "1020");
      await user.selectOptions(timeFields()[1] as HTMLSelectElement, "960");
      expect(saveTimes()).toBeDisabled();
    });

    it("switches are saved with the times, all in one call", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(
        screen.getByRole("switch", { name: t.rota.messageNames.summary }),
      );
      await user.click(
        screen.getByRole("switch", { name: t.rota.messageNames.reminder }),
      );
      await user.selectOptions(timeFields()[3] as HTMLSelectElement, "1230");
      expect(m.fns.update).not.toHaveBeenCalled();
      await user.click(saveTimes());
      expect(m.fns.update).toHaveBeenCalledTimes(1);
      expect(m.fns.update).toHaveBeenCalledWith({
        ...args,
        messages: {
          ...baseSettings.messages,
          reminder: { at: 960, on: false },
          summary: { at: 1230, on: true },
        },
      });
    });

    it("an off message still lets its time be changed", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.selectOptions(timeFields()[3] as HTMLSelectElement, "1230");
      await user.click(saveTimes());
      expect(m.fns.update).toHaveBeenCalledWith({
        ...args,
        messages: {
          ...baseSettings.messages,
          summary: { at: 1230, on: false },
        },
      });
    });

    it("the day's message time is changed in the first row", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.selectOptions(timeFields()[0] as HTMLSelectElement, "540");
      await user.click(saveTimes());
      expect(m.fns.update).toHaveBeenCalledWith({
        ...args,
        messages: { ...baseSettings.messages, dayAt: 540 },
      });
    });

    it("moves that only work together can be saved together", async () => {
      // Reminder 16:00, unread 19:00: the unread list can't move before the reminder alone.
      const user = userEvent.setup();
      renderPage();
      await user.selectOptions(timeFields()[1] as HTMLSelectElement, "1200");
      await user.selectOptions(timeFields()[2] as HTMLSelectElement, "1230");
      await user.click(saveTimes());
      expect(m.fns.update).toHaveBeenCalledWith({
        ...args,
        messages: {
          ...baseSettings.messages,
          reminder: { at: 1200, on: true },
          unread: { at: 1230, on: true },
        },
      });
    });

    it("says when the order of the times is wrong, without sending anything", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.selectOptions(timeFields()[0] as HTMLSelectElement, "1200");
      await user.click(saveTimes());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.rota.errors.invalid_times ?? "",
      );
      expect(m.fns.update).not.toHaveBeenCalled();
    });

    it("still shows the server's refusal", async () => {
      m.fns.update.mockResolvedValue({ error: "invalid_times" });
      const user = userEvent.setup();
      renderPage();
      await user.selectOptions(timeFields()[1] as HTMLSelectElement, "1020");
      await user.click(saveTimes());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.rota.errors.invalid_times ?? "",
      );
    });

    it("an archived khatma's times can't be saved", () => {
      m.settings = { ...baseSettings, archived: true };
      renderPage();
      expect(saveTimes()).toBeDisabled();
    });
  });

  describe("the khatma itself", () => {
    const details = () => section(t.rota.detailsHeading);
    const save = () =>
      within(details()).getByRole("button", { name: t.organizer.save });

    it("starts with save off and the current values", () => {
      renderPage();
      expect(save()).toBeDisabled();
      expect(within(details()).getByLabelText(t.rota.nameLabel)).toHaveValue(
        "ختمة العائلة",
      );
      expect(
        within(details()).getByRole("radio", { name: "كل يوم" }),
      ).toBeChecked();
      expect(within(details()).getByText("تستمر دائماً")).toBeInTheDocument();
    });

    it("shows the time zone first in the list", () => {
      renderPage();
      const zone = within(details()).getByLabelText(
        t.rota.timeZoneLabel,
      ) as HTMLSelectElement;
      expect(zone.options[0]?.value).toBe("Asia/Dubai");
      expect(zone).toHaveValue("Asia/Dubai");
      expect(
        Array.from(zone.options).filter((o) => o.value === "Asia/Dubai"),
      ).toHaveLength(1);
      expect(zone.options.length).toBeGreaterThan(50);
    });

    it("saves only what changed: the name", async () => {
      const user = userEvent.setup();
      renderPage();
      const name = within(details()).getByLabelText(t.rota.nameLabel);
      await user.clear(name);
      await user.type(name, "  ختمة رمضان ");
      await user.click(save());
      expect(m.fns.update).toHaveBeenCalledWith({
        ...args,
        name: "ختمة رمضان",
      });
      expect(await screen.findByText(t.organizer.saved)).toBeInTheDocument();
    });

    it("cannot save an empty name", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.clear(within(details()).getByLabelText(t.rota.nameLabel));
      expect(save()).toBeDisabled();
    });

    it("saves the time zone", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.selectOptions(
        within(details()).getByLabelText(t.rota.timeZoneLabel),
        "Europe/London",
      );
      await user.click(save());
      expect(m.fns.update).toHaveBeenCalledWith({
        ...args,
        timeZone: "Europe/London",
      });
    });

    it("saves an end date, and no end again", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(
        within(details()).getByRole("button", {
          name: `${t.rota.endLabel}: ${t.rota.change}`,
        }),
      );
      fireEvent.change(within(details()).getByLabelText(t.rota.endDateInput), {
        target: { value: "2027-03-01" },
      });
      await user.click(save());
      expect(m.fns.update).toHaveBeenCalledWith({
        ...args,
        endDate: "2027-03-01",
      });
    });

    it("an end date can't be picked before today, even for a khatma that started long ago", async () => {
      m.settings = { ...baseSettings, firstDate: "2026-10-01" };
      const user = userEvent.setup();
      renderPage();
      await user.click(
        within(details()).getByRole("button", {
          name: `${t.rota.endLabel}: ${t.rota.change}`,
        }),
      );
      expect(
        within(details()).getByLabelText(t.rota.endDateInput),
      ).toHaveAttribute("min", "2026-10-29");
    });

    it("changing the days of a khatma still ahead moves its start to the first reading day", async () => {
      m.settings = { ...baseSettings, firstDatePassed: false };
      const user = userEvent.setup();
      renderPage();
      await user.click(
        within(details()).getByRole("radio", { name: "كل أسبوع" }),
      );
      // Friday the 30th is the first date already; a Saturday-only khatma starts on the 31st.
      await user.click(
        within(details()).getByRole("button", { name: "السبت" }),
      );
      await user.click(
        within(details()).getByRole("button", { name: "الجمعة" }),
      );
      await user.click(save());
      expect(m.fns.update).toHaveBeenCalledWith({
        ...args,
        days: { kind: "weekly", weekdays: [6], everyWeeks: 1 },
        firstDate: "2026-10-31",
      });
    });

    it("changing the days of a khatma already running leaves its start", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(
        within(details()).getByRole("radio", { name: "كل أسبوع" }),
      );
      await user.click(save());
      expect(m.fns.update).toHaveBeenCalledWith({
        ...args,
        days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
      });
    });

    it("shows a refusal from the server and a network failure", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.type(within(details()).getByLabelText(t.rota.nameLabel), "ـ");
      m.fns.update.mockResolvedValue({ error: "invalid_dates" });
      await user.click(save());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.rota.errors.invalid_dates ?? "",
      );
      m.fns.update.mockRejectedValue(new Error("offline"));
      await user.click(save());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.errors.network,
      );
      m.fns.update.mockRejectedValue(new ConvexError({ code: "forbidden" }));
      await user.click(save());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.rota.errors.forbidden ?? "",
      );
    });
  });

  it("an archived khatma says so and can't be changed", () => {
    m.settings = { ...baseSettings, archived: true };
    renderPage();
    expect(screen.getByText(t.rota.archivedSettings)).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: t.rota.pauseNow }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: t.rota.addDate })).toBeDisabled();
    expect(
      within(section(t.rota.detailsHeading)).getByLabelText(t.rota.nameLabel),
    ).toBeDisabled();
    // Everything that edits is off; only the two ways out of an archived khatma are left on.
    const ways: string[] = [t.archive.restart, t.archive.delete];
    for (const button of screen.getAllByRole("button")) {
      if (ways.includes(button.textContent ?? "")) continue;
      expect(button).toBeDisabled();
    }
    // The way back still works.
    expect(
      screen.getByRole("link", { name: t.organizer.back }),
    ).toBeInTheDocument();
  });

  describe("archiving, starting again and deleting", () => {
    it("an active khatma can be archived after a confirmation, and has no restart or delete", async () => {
      const user = userEvent.setup();
      renderPage();
      expect(
        screen.queryByRole("button", { name: t.archive.restart }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: t.archive.delete }),
      ).toBeNull();
      await user.click(screen.getByRole("button", { name: t.archive.button }));
      const sheet = screen.getByRole("dialog", { name: t.archive.title });
      expect(within(sheet).getByText(t.archive.body)).toBeInTheDocument();
      expect(m.fns.archive).not.toHaveBeenCalled();
      await user.click(
        within(sheet).getByRole("button", { name: t.archive.confirm }),
      );
      expect(m.fns.archive).toHaveBeenCalledWith(args);
    });

    it("an archived khatma can start again or be deleted, and can't be archived again", () => {
      m.settings = { ...baseSettings, archived: true };
      renderPage();
      expect(
        screen.getByRole("button", { name: t.archive.restart }),
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: t.archive.delete }),
      ).toBeEnabled();
      expect(
        screen.queryByRole("button", { name: t.archive.button }),
      ).toBeNull();
    });

    it("starting again uses the khatma's own days and zone, then goes to the setup", async () => {
      m.settings = {
        ...baseSettings,
        archived: true,
        timeZone: "Asia/Dubai",
        days: { kind: "daily" },
      };
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole("button", { name: t.archive.restart }));
      await user.click(
        screen.getByRole("button", { name: t.archive.restartConfirm }),
      );
      // 08:00 UTC on the 29th is noon in Dubai, so tomorrow is the 30th.
      expect(m.startAgain).toHaveBeenCalledWith({
        ...args,
        firstDate: "2026-10-30",
      });
      expect(
        await screen.findByText("landed /j/NEWCODE/setup"),
      ).toBeInTheDocument();
    });

    it("while a delete runs, the page stays on «جارٍ الحذف» when its settings turn null", async () => {
      m.settings = { ...baseSettings, archived: true };
      m.fns.remove.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      const view = renderPage();
      await user.click(screen.getByRole("button", { name: t.archive.delete }));
      await user.click(
        screen.getByRole("button", { name: t.archive.deleteConfirm }),
      );
      expect(m.fns.remove).toHaveBeenCalledWith(args);
      m.settings = null;
      view.rerender(
        <MemoryRouter initialEntries={["/j/CODE/settings"]}>
          <Routes>
            <Route
              path="/j/:inviteCode/settings"
              element={<RotaSettingsPage />}
            />
            <Route path="/j/:inviteCode" element={<Landing />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.getByText(t.archive.deleting)).toBeInTheDocument();
      expect(screen.queryByText("landed /j/CODE")).toBeNull();
    });

    it("deleting asks first, then goes home", async () => {
      m.settings = { ...baseSettings, archived: true };
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole("button", { name: t.archive.delete }));
      expect(m.fns.remove).not.toHaveBeenCalled();
      await user.click(
        screen.getByRole("button", { name: t.archive.deleteConfirm }),
      );
      expect(m.fns.remove).toHaveBeenCalledWith(args);
      expect(await screen.findByText("landed /")).toBeInTheDocument();
    });
  });
});
