import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/ar";
import { CheerField } from "./CheerField";

const HOUR = 3_600_000;
const defaults = {
  on: true,
  everyone: false,
  gapMs: 24 * HOUR,
  showName: false,
  showJuz: false,
};

describe("CheerField", () => {
  it("starts from the defaults and saves the khatma's own choice", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <CheerField
        setting={{ override: null, defaults }}
        disabled={false}
        onSave={onSave}
      />,
    );
    expect(screen.getByText(t.cheer.followsDefault)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t.organizer.save }),
    ).toBeDisabled();

    await user.selectOptions(
      screen.getByLabelText(t.cheer.audienceLabel),
      t.cheer.audience.everyone,
    );
    expect(screen.queryByText(t.cheer.followsDefault)).toBeNull();
    await user.selectOptions(screen.getByLabelText(t.cheer.gapLabel), "0");
    await user.click(screen.getByRole("button", { name: t.organizer.save }));

    expect(onSave).toHaveBeenCalledWith({
      on: true,
      everyone: true,
      gapMs: 0,
      showName: false,
      showJuz: false,
    });
  });

  it("lets the organizer show the reader's name and juz'", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <CheerField
        setting={{ override: null, defaults }}
        disabled={false}
        onSave={onSave}
      />,
    );
    await user.click(
      screen.getByRole("switch", { name: t.cheer.showNameLabel }),
    );
    await user.click(
      screen.getByRole("switch", { name: t.cheer.showJuzLabel }),
    );
    await user.click(screen.getByRole("button", { name: t.organizer.save }));

    expect(onSave).toHaveBeenCalledWith({
      ...defaults,
      showName: true,
      showJuz: true,
    });
  });

  it("hides whom and how often while switched off", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <CheerField
        setting={{ override: null, defaults }}
        disabled={false}
        onSave={onSave}
      />,
    );
    await user.click(screen.getByRole("switch", { name: t.cheer.switchLabel }));

    expect(screen.queryByLabelText(t.cheer.gapLabel)).toBeNull();
    await user.click(screen.getByRole("button", { name: t.organizer.save }));
    expect(onSave).toHaveBeenCalledWith({ ...defaults, on: false });
  });

  it("goes back to the defaults", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const own = {
      on: true,
      everyone: true,
      gapMs: 6 * HOUR,
      showName: false,
      showJuz: false,
    };
    const field = (override: typeof own | null) => (
      <CheerField
        setting={{ override, defaults }}
        disabled={false}
        onSave={onSave}
      />
    );
    const { rerender } = render(field(own));
    expect(screen.queryByText(t.cheer.followsDefault)).toBeNull();
    expect(screen.getByLabelText(t.cheer.gapLabel)).toHaveValue(
      String(6 * HOUR),
    );

    await user.click(screen.getByRole("button", { name: t.cheer.useDefault }));
    expect(onSave).toHaveBeenCalledWith(null);

    rerender(field(null));
    expect(screen.getByLabelText(t.cheer.gapLabel)).toHaveValue(
      String(24 * HOUR),
    );
  });

  it("shows what the server holds, not an old copy, when it changes", () => {
    const field = (gapMs: number) => (
      <CheerField
        setting={{ override: null, defaults: { ...defaults, gapMs } }}
        disabled={false}
        onSave={vi.fn()}
      />
    );
    const { rerender } = render(field(6 * HOUR));

    rerender(field(3 * 24 * HOUR));

    expect(screen.getByLabelText(t.cheer.gapLabel)).toHaveValue(
      String(3 * 24 * HOUR),
    );
    expect(
      screen.getByRole("button", { name: t.organizer.save }),
    ).toBeDisabled();
  });

  it("offers a gap the admin set outside the usual list", () => {
    render(
      <CheerField
        setting={{
          override: null,
          defaults: { ...defaults, gapMs: 12 * HOUR },
        }}
        disabled={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(t.cheer.gapLabel)).toHaveValue(
      String(12 * HOUR),
    );
    expect(
      screen.getByRole("option", { name: t.cheer.gapEvery(12 * HOUR) }),
    ).toBeInTheDocument();
  });
});
