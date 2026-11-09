import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { SettingField } from "./SettingField";

const m = vi.hoisted(() => ({ set: vi.fn(), reset: vi.fn() }));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useMutation: (ref: never) =>
      getFunctionName(ref) === "adminSettings:set" ? m.set : m.reset,
  };
});
vi.mock("../lib/adminSession", () => ({ useAdminToken: () => "tok" }));

const maxMembers = {
  key: "maxMembers" as const,
  value: 60,
  defaultValue: 60,
  isDefault: true,
  spec: { kind: "int" as const, min: 2, max: 500, group: "limits" as const },
};

beforeEach(() => {
  m.set.mockReset().mockResolvedValue({ ok: true });
  m.reset.mockReset().mockResolvedValue({ ok: true });
});

async function edit(value: string) {
  await userEvent.click(
    screen.getByRole("button", {
      name: `${t.settings.edit} ${t.settings.labels.maxMembers}`,
    }),
  );
  const input = screen.getByRole("textbox", {
    name: t.settings.labels.maxMembers,
  });
  await userEvent.clear(input);
  await userEvent.type(input, value);
  await userEvent.click(screen.getByRole("button", { name: t.settings.save }));
}

describe("SettingField", () => {
  it("shows the label, what it does, and the value", () => {
    render(<SettingField setting={maxMembers} />);
    expect(screen.getByText(t.settings.labels.maxMembers)).toBeInTheDocument();
    expect(
      screen.getByText(t.settings.help.maxMembers.what),
    ).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.queryByText(t.settings.custom)).not.toBeInTheDocument();
  });

  it("marks a changed setting, and reads its value as the row's description", () => {
    render(
      <SettingField setting={{ ...maxMembers, value: 40, isDefault: false }} />,
    );
    expect(screen.getByText(t.settings.custom)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `${t.settings.edit} ${t.settings.labels.maxMembers}`,
      }),
    ).toHaveAccessibleDescription(
      `40 · ${t.settings.custom} ${t.settings.help.maxMembers.what}`,
    );
  });

  it("explains the default and the range in the sheet", async () => {
    render(<SettingField setting={maxMembers} />);
    await userEvent.click(
      screen.getByRole("button", {
        name: `${t.settings.edit} ${t.settings.labels.maxMembers}`,
      }),
    );
    const sheet = screen.getByRole("dialog");
    expect(
      within(sheet).getByText(t.settings.help.maxMembers.why),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByText(`${t.settings.defaultValue}: 60`),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByText(t.settings.range("2", "500")),
    ).toBeInTheDocument();
  });

  it("flips a switch in place, named without its badge", async () => {
    render(
      <SettingField
        setting={{
          key: "maintenanceMode",
          value: true,
          defaultValue: false,
          isDefault: false,
          spec: { kind: "bool", group: "switches" },
        }}
      />,
    );
    await userEvent.click(
      screen.getByRole("switch", { name: t.settings.labels.maintenanceMode }),
    );
    expect(m.set).toHaveBeenCalledWith({
      adminToken: "tok",
      key: "maintenanceMode",
      value: false,
    });
  });

  it("sends a number, not text", async () => {
    render(<SettingField setting={maxMembers} />);
    await edit("40");
    expect(m.set).toHaveBeenCalledWith({
      adminToken: "tok",
      key: "maxMembers",
      value: 40,
    });
  });

  it("accepts Arabic digits", async () => {
    render(<SettingField setting={maxMembers} />);
    await edit("٤٠");
    expect(m.set).toHaveBeenCalledWith(expect.objectContaining({ value: 40 }));
  });

  it("shows the server's reason when a value is refused", async () => {
    m.set.mockResolvedValue({ error: "out_of_range" });
    render(<SettingField setting={maxMembers} />);
    await edit("1");
    expect(screen.getByRole("alert")).toHaveTextContent(
      t.settings.errors.out_of_range,
    );
  });

  it("sends durations in milliseconds from a number and a unit", async () => {
    render(
      <SettingField
        setting={{
          key: "defaultPaceMs",
          value: 3 * 86_400_000,
          defaultValue: 3 * 86_400_000,
          isDefault: true,
          spec: {
            kind: "duration",
            min: 86_400_000,
            max: 14 * 86_400_000,
            group: "pace",
          },
        }}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: `${t.settings.edit} ${t.settings.labels.defaultPaceMs}`,
      }),
    );
    const amount = screen.getByRole("textbox", {
      name: t.settings.labels.defaultPaceMs,
    });
    expect(amount).toHaveValue("3");
    await userEvent.clear(amount);
    await userEvent.type(amount, "36");
    await userEvent.selectOptions(
      screen.getByLabelText(t.settings.unit),
      "hours",
    );
    await userEvent.click(
      screen.getByRole("button", { name: t.settings.save }),
    );
    expect(m.set).toHaveBeenCalledWith(
      expect.objectContaining({ key: "defaultPaceMs", value: 36 * 3_600_000 }),
    );
  });

  it("edits a time from a select of 15-minute steps and saves minutes", async () => {
    render(
      <SettingField
        setting={{
          key: "rotaDayAt",
          value: 480,
          defaultValue: 480,
          isDefault: true,
          spec: { kind: "time", group: "rota" },
        }}
      />,
    );
    expect(
      screen.getByText("8:00 ص", { selector: "span" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", {
        name: `${t.settings.edit} ${t.settings.labels.rotaDayAt}`,
      }),
    );
    const select = screen.getByRole("combobox", {
      name: t.settings.labels.rotaDayAt,
    });
    expect(within(select).getAllByRole("option")).toHaveLength(96);
    await userEvent.selectOptions(select, "495");
    await userEvent.click(
      screen.getByRole("button", { name: t.settings.save }),
    );
    expect(m.set).toHaveBeenCalledWith({
      adminToken: "tok",
      key: "rotaDayAt",
      value: 495,
    });
  });

  it("goes back to the default", async () => {
    render(
      <SettingField setting={{ ...maxMembers, value: 40, isDefault: false }} />,
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: `${t.settings.edit} ${t.settings.labels.maxMembers}`,
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: t.settings.reset }),
    );
    expect(m.reset).toHaveBeenCalledWith({
      adminToken: "tok",
      key: "maxMembers",
    });
  });
});
