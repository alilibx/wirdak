import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSessionToken, getSessionToken } from "../../lib/session";
import { t } from "../../i18n/ar";
import { useVerification } from "./useVerification";

const m = vi.hoisted(() => ({
  status: undefined as unknown,
  sessions: undefined as unknown,
  queryCalls: [] as Array<[string, unknown]>,
  claim: vi.fn(),
  confirmPin: vi.fn(),
  reject: vi.fn(),
  signOutOthers: vi.fn(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never, args: unknown) => {
      const name = getFunctionName(ref);
      m.queryCalls.push([name, args]);
      if (args === "skip") return undefined;
      return name === "verification:status" ? m.status : m.sessions;
    },
    useAction: (ref: never) => {
      const name = getFunctionName(ref);
      return name === "verification:claim" ? m.claim : m.confirmPin;
    },
    useMutation: (ref: never) => {
      const name = getFunctionName(ref);
      return name === "verification:reject" ? m.reject : m.signOutOthers;
    },
  };
});

const STORE = "wirdak.verify";
const START = {
  verificationId: "v1",
  secret: "sec",
  code: "AAAA-BBBB-CC",
  waNumber: "971500000000",
  message: "رمز التحقق في وِردك: AAAA-BBBB-CC",
};
const WA_URL =
  "https://wa.me/971500000000?text=" + encodeURIComponent(START.message);

const fetchMock = vi.fn();
const fakeWindow = {
  location: { href: "" },
  closed: false,
  close: vi.fn(),
  opener: {} as unknown,
};
const open = vi.fn();

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
}

function setStatus(status: string, maskedPhone: string | null = null) {
  m.status = { status, maskedPhone };
}

async function started() {
  reply(200, START);
  const hook = renderHook(() => useVerification());
  await act(async () => {
    await hook.result.current.start();
  });
  return hook;
}

beforeEach(() => {
  localStorage.clear();
  clearSessionToken();
  m.status = undefined;
  m.sessions = undefined;
  m.queryCalls = [];
  m.claim.mockReset();
  m.confirmPin.mockReset();
  m.reject.mockReset();
  m.signOutOthers.mockReset();
  fetchMock.mockReset();
  fakeWindow.location.href = "";
  fakeWindow.closed = false;
  fakeWindow.opener = {};
  fakeWindow.close.mockReset();
  open.mockReset();
  open.mockReturnValue(fakeWindow);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("open", open);
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://x.convex.site");
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("useVerification: start", () => {
  it("posts the client key without a name, moves to waiting and persists progress", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    window.history.replaceState(null, "", "/j/ABC123");
    const { result } = await started();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x.convex.site/api/verification/start");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body).not.toHaveProperty("displayName");
    expect(body.clientKey).toMatch(/^[0-9a-f]{32}$/);
    // The WhatsApp reply links back to this page, not the home page.
    expect(body.returnPath).toBe("/j/ABC123");
    expect(result.current.step).toBe("waiting");
    expect(JSON.parse(localStorage.getItem(STORE) ?? "null")).toMatchObject({
      verificationId: "v1",
      secret: "sec",
      expiresAt: 1_000_000 + 10 * 60_000,
    });
  });

  it("opens a blank window in the click and points it at WhatsApp after the fetch", async () => {
    const { result } = await started();
    expect(open).toHaveBeenCalledTimes(1);
    expect(fakeWindow.location.href).toBe(WA_URL);
    expect(fakeWindow.opener).toBeNull();
    expect(result.current.waUrl).toBe(WA_URL);
    expect(result.current.opened).toBe(true);
  });

  it("falls back to the link alone when the popup is blocked", async () => {
    open.mockReturnValue(null);
    const { result } = await started();
    expect(result.current.step).toBe("waiting");
    expect(result.current.opened).toBe(false);
    expect(result.current.waUrl).toBe(WA_URL);
  });

  it("closes the blank window when start fails", async () => {
    reply(429, { error: "rate_limited" });
    const { result } = renderHook(() => useVerification());
    await act(async () => {
      await result.current.start();
    });
    expect(fakeWindow.close).toHaveBeenCalled();
  });

  it.each([
    ["rate_limited", 429, true],
    ["maintenance", 503, true],
    ["whatsapp_not_configured", 503, false],
  ] as const)(
    "start error %s shows its message",
    async (code, status, retry) => {
      reply(status, { error: code });
      const { result } = renderHook(() => useVerification());
      await act(async () => {
        await result.current.start();
      });
      expect(result.current.step).toBe("error");
      expect(result.current.error).toBe(t.verify.errors[code]);
      expect(result.current.canRetry).toBe(retry);
      expect(localStorage.getItem(STORE)).toBeNull();
    },
  );

  it("a network failure is a retryable error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const { result } = renderHook(() => useVerification());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.step).toBe("error");
    expect(result.current.error).toBe(t.verify.errors.network);
    expect(result.current.canRetry).toBe(true);
    await act(async () => result.current.reset());
    expect(result.current.step).toBe("start");
    expect(result.current.error).toBeNull();
  });

  it("reopenWhatsApp opens the same link", async () => {
    const { result } = await started();
    open.mockClear();
    act(() => result.current.reopenWhatsApp());
    expect(open).toHaveBeenCalledWith(WA_URL, "_blank", "noopener");
  });
});

describe("useVerification: statuses", () => {
  it("status pending stays on waiting", async () => {
    setStatus("pending");
    const { result } = await started();
    expect(result.current.step).toBe("waiting");
  });

  it("status matched moves to confirm, and confirm stores the token", async () => {
    setStatus("matched", "+971 50 ••• 1234");
    m.claim.mockResolvedValue({ sessionToken: "tok" });
    const { result } = await started();
    expect(result.current.step).toBe("confirm");
    expect(result.current.maskedPhone).toBe("+971 50 ••• 1234");
    await act(async () => {
      await result.current.confirm("  علي ");
    });
    expect(m.claim).toHaveBeenCalledWith({
      verificationId: "v1",
      secret: "sec",
      deviceLabel: expect.any(String),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      displayName: "علي",
    });
    expect(getSessionToken()).toBe("tok");
    expect(result.current.step).toBe("done");
    expect(localStorage.getItem(STORE)).toBeNull();
  });

  it("a blank name on confirm shows the name error and does not claim", async () => {
    setStatus("matched", "+971 50 ••• 1234");
    const { result } = await started();
    await act(async () => {
      await result.current.confirm("   ");
    });
    expect(result.current.step).toBe("confirm");
    expect(result.current.error).toBe(t.verify.errors.nameRequired);
    expect(m.claim).not.toHaveBeenCalled();
  });

  it.each([
    ["name_required", "nameRequired"],
    ["invalid_name", "invalid_name"],
  ] as const)(
    "claim answering %s keeps the confirm step and the attempt",
    async (answer, code) => {
      setStatus("matched", "+971 50 ••• 1234");
      m.claim.mockResolvedValue({ error: answer });
      const { result } = await started();
      await act(async () => {
        await result.current.confirm("علي");
      });
      expect(result.current.step).toBe("confirm");
      expect(result.current.error).toBe(t.verify.errors[code]);
      expect(localStorage.getItem(STORE)).not.toBeNull();
    },
  );

  it("claim answering needs_pin goes to the pin step", async () => {
    setStatus("matched", "+971 50 ••• 1234");
    m.claim.mockResolvedValue({ error: "needs_pin" });
    const { result } = await started();
    await act(async () => {
      await result.current.confirm("علي");
    });
    expect(result.current.step).toBe("pin");
    expect(getSessionToken()).toBeNull();
  });

  it("claim answering expired is an error", async () => {
    setStatus("matched");
    m.claim.mockResolvedValue({ error: "expired" });
    const { result } = await started();
    await act(async () => {
      await result.current.confirm("علي");
    });
    expect(result.current.step).toBe("error");
    expect(result.current.error).toBe(t.verify.errors.expired);
  });

  it("a claim that throws keeps the attempt on the confirm step with a network error", async () => {
    setStatus("matched");
    m.claim.mockRejectedValueOnce(new Error("boom"));
    m.claim.mockResolvedValueOnce({ sessionToken: "tok" });
    const { result } = await started();
    await act(async () => {
      await result.current.confirm("علي");
    });
    expect(result.current.step).toBe("confirm");
    expect(result.current.error).toBe(t.verify.errors.network);
    expect(localStorage.getItem(STORE)).not.toBeNull();
    await act(async () => {
      await result.current.confirm("علي");
    });
    expect(result.current.error).toBeNull();
    expect(result.current.step).toBe("done");
  });

  it("status expired is an error and clears the saved progress", async () => {
    setStatus("expired");
    const { result } = await started();
    expect(result.current.step).toBe("error");
    expect(result.current.error).toBe(t.verify.errors.expired);
    expect(localStorage.getItem(STORE)).toBeNull();
  });

  it("status rejected from the live query is a retryable error", async () => {
    setStatus("rejected");
    const { result } = await started();
    expect(result.current.step).toBe("error");
    expect(result.current.error).toBe(t.verify.errors.rejected);
    expect(result.current.canRetry).toBe(true);
    expect(localStorage.getItem(STORE)).toBeNull();
  });

  it("notMe rejects, clears progress and shows the rejected error", async () => {
    setStatus("matched", "+971 50 ••• 1234");
    m.reject.mockResolvedValue(null);
    const { result } = await started();
    await act(async () => {
      await result.current.notMe();
    });
    expect(m.reject).toHaveBeenCalledWith({
      verificationId: "v1",
      secret: "sec",
    });
    expect(result.current.step).toBe("error");
    expect(result.current.error).toBe(t.verify.errors.rejected);
    expect(result.current.canRetry).toBe(true);
    expect(localStorage.getItem(STORE)).toBeNull();
  });

  it("status claimed with a stored session is done; without one it is an error", async () => {
    setStatus("claimed");
    const noToken = await started();
    expect(noToken.result.current.step).toBe("error");
    expect(noToken.result.current.error).toBe(t.verify.errors.generic);
    noToken.unmount();
    localStorage.clear();
    const { setSessionToken } = await import("../../lib/session");
    setSessionToken("tok");
    const withToken = await started();
    expect(withToken.result.current.step).toBe("done");
  });
});

describe("useVerification: pin", () => {
  async function atPin() {
    setStatus("needs_pin", "+971 50 ••• 1234");
    return started();
  }

  it("needs_pin moves to pin and a wrong pin shows an error", async () => {
    m.confirmPin.mockResolvedValue({ error: "wrong_pin" });
    const { result } = await atPin();
    expect(result.current.step).toBe("pin");
    await act(async () => {
      await result.current.submitPin("123456");
    });
    expect(result.current.step).toBe("pin");
    expect(result.current.error).toBe(t.verify.errors.wrong_pin);
    expect(getSessionToken()).toBeNull();
  });

  it("normalizes Arabic digits and spaces before sending", async () => {
    m.confirmPin.mockResolvedValue({ sessionToken: "tok", otherSessions: 0 });
    const { result } = await atPin();
    await act(async () => {
      await result.current.submitPin("١٢٣ ٤٥٦");
    });
    expect(m.confirmPin).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationId: "v1",
        secret: "sec",
        pin: "123456",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    );
    expect(getSessionToken()).toBe("tok");
    expect(result.current.step).toBe("done");
  });

  it("a pin call that throws keeps the pin step with a network error", async () => {
    m.confirmPin.mockRejectedValue(new Error("boom"));
    const { result } = await atPin();
    await act(async () => {
      await result.current.submitPin("123456");
    });
    expect(result.current.step).toBe("pin");
    expect(result.current.error).toBe(t.verify.errors.network);
    expect(localStorage.getItem(STORE)).not.toBeNull();
  });

  it("ignores a pin that is not six digits", async () => {
    const { result } = await atPin();
    await act(async () => {
      await result.current.submitPin("123");
    });
    expect(m.confirmPin).not.toHaveBeenCalled();
  });

  it("too_many_attempts ends in a retryable error", async () => {
    m.confirmPin.mockResolvedValue({ error: "too_many_attempts" });
    const { result } = await atPin();
    await act(async () => {
      await result.current.submitPin("123456");
    });
    expect(result.current.step).toBe("error");
    expect(result.current.error).toBe(t.verify.errors.too_many_attempts);
    expect(result.current.canRetry).toBe(true);
  });

  it("other sessions lead to the devices step, then signing them out finishes", async () => {
    m.confirmPin.mockResolvedValue({ sessionToken: "tok", otherSessions: 2 });
    m.signOutOthers.mockResolvedValue(null);
    const { result } = await atPin();
    await act(async () => {
      await result.current.submitPin("123456");
    });
    expect(result.current.step).toBe("devices");
    expect(getSessionToken()).toBe("tok");
    await act(async () => {
      await result.current.signOutOthers();
    });
    expect(m.signOutOthers).toHaveBeenCalledWith({ sessionToken: "tok" });
    expect(result.current.step).toBe("done");
  });

  it("a failed sign-out stays on the devices step with the error", async () => {
    m.confirmPin.mockResolvedValue({ sessionToken: "tok", otherSessions: 2 });
    m.signOutOthers.mockRejectedValue(new Error("offline"));
    const { result } = await atPin();
    await act(async () => {
      await result.current.submitPin("123456");
    });
    await act(async () => {
      await result.current.signOutOthers();
    });
    expect(result.current.step).toBe("devices");
    expect(result.current.error).toBe(t.verify.errors.network);
    expect(getSessionToken()).toBe("tok");
    act(() => result.current.continueFromDevices());
    expect(result.current.step).toBe("done");
  });

  it("continuing from the devices step finishes without signing out", async () => {
    m.confirmPin.mockResolvedValue({ sessionToken: "tok", otherSessions: 1 });
    const { result } = await atPin();
    await act(async () => {
      await result.current.submitPin("123456");
    });
    act(() => result.current.continueFromDevices());
    expect(result.current.step).toBe("done");
    expect(m.signOutOthers).not.toHaveBeenCalled();
  });
});

describe("useVerification: intent", () => {
  it("stores what the verification is for with the progress", async () => {
    reply(200, START);
    const intent = { kind: "take", inviteCode: "CODE", juz: 7 } as const;
    const { result } = renderHook(() => useVerification(intent));
    await act(async () => {
      await result.current.start();
    });
    expect(JSON.parse(localStorage.getItem(STORE) ?? "null")).toMatchObject({
      verificationId: "v1",
      intent,
    });
  });
});

describe("useVerification: resume from storage", () => {
  const save = (over: Record<string, unknown> = {}) =>
    localStorage.setItem(
      STORE,
      JSON.stringify({
        verificationId: "v9",
        secret: "s9",
        expiresAt: Date.now() + 5 * 60_000,
        waUrl: WA_URL,
        ...over,
      }),
    );

  it("resumes at waiting and queries the stored verification", () => {
    save();
    setStatus("pending");
    const { result } = renderHook(() => useVerification());
    expect(result.current.step).toBe("waiting");
    expect(m.queryCalls).toContainEqual([
      "verification:status",
      { verificationId: "v9", secret: "s9" },
    ]);
  });

  it("resumes at confirm when the live status says matched", () => {
    save();
    setStatus("matched", "+971 50 ••• 1234");
    const { result } = renderHook(() => useVerification());
    expect(result.current.step).toBe("confirm");
  });

  it("resumes at pin when the live status says needs_pin", () => {
    save();
    setStatus("needs_pin", "+971 50 ••• 1234");
    const { result } = renderHook(() => useVerification());
    expect(result.current.step).toBe("pin");
  });

  it.each([
    ["matched", "confirm"],
    ["needs_pin", "pin"],
  ] as const)(
    "%s late in the window renews the stored expiry, so a reload still resumes at %s",
    async (status, step) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const t0 = 1_000_000;
      vi.setSystemTime(t0);
      setStatus("pending");
      const first = await started();
      // the server restarts its 10 minutes when the message matches at 9m
      vi.setSystemTime(t0 + 9 * 60_000);
      setStatus(status, "+971 50 ••• 1234");
      first.rerender();
      expect(first.result.current.step).toBe(step);
      expect(JSON.parse(localStorage.getItem(STORE) ?? "null")).toMatchObject({
        verificationId: "v1",
        expiresAt: t0 + 19 * 60_000,
      });
      first.unmount();
      // reloaded at 11m: past the first deadline, inside the renewed one
      vi.setSystemTime(t0 + 11 * 60_000);
      const reloaded = renderHook(() => useVerification());
      expect(reloaded.result.current.step).toBe(step);
    },
  );

  it("resumes progress saved before the name moved to confirm", () => {
    save({ displayName: "سارة" });
    setStatus("matched", "+971 50 ••• 1234");
    const { result } = renderHook(() => useVerification());
    expect(result.current.step).toBe("confirm");
  });

  it("drops expired or malformed progress", () => {
    save({ expiresAt: Date.now() - 1 });
    const stale = renderHook(() => useVerification());
    expect(stale.result.current.step).toBe("start");
    expect(localStorage.getItem(STORE)).toBeNull();
    localStorage.setItem(STORE, "{not json");
    const bad = renderHook(() => useVerification());
    expect(bad.result.current.step).toBe("start");
    expect(localStorage.getItem(STORE)).toBeNull();
  });

  it("starts at start with nothing saved and skips the status query", () => {
    const { result } = renderHook(() => useVerification());
    expect(result.current.step).toBe("start");
    expect(m.queryCalls).toContainEqual(["verification:status", "skip"]);
  });
});
