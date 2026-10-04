import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import type { LogEntry } from "../../src/shared/app-state";
import PlayerChatPanel from "../../src/renderer/src/components/PlayerChatPanel.vue";
import { normalizeHiddenDashboardFixtures } from "../../src/renderer/src/lib/dashboard-fixtures";
import {
  projectDiagnosticLogs,
  projectPlayerChatEntries,
  type PlayerChatDisplayEntry,
} from "../../src/renderer/src/lib/player-chat-display";
import { baseTime } from "./fixtures";

describe("Player Chat dashboard panel", () => {
  test("projects structured chat separately without consuming diagnostic history", () => {
    const logs: LogEntry[] = [
      chatLog("chat-new", "NewPlayer", "hello", true),
      diagnosticLog("diagnostic-new", "Capture opened."),
      chatLog("chat-old", "OldPlayer", "still here", false),
      diagnosticLog("diagnostic-old", "Parser ready."),
    ];

    expect(projectDiagnosticLogs(logs, 2).map((entry) => entry.id)).toEqual([
      "diagnostic-new",
      "diagnostic-old",
    ]);
    expect(projectPlayerChatEntries(logs).map((entry) => entry.id)).toEqual([
      "chat-new",
      "chat-old",
    ]);
    expect(projectPlayerChatEntries(logs, 1)[0]).toMatchObject({
      playerName: "NewPlayer",
      message: "hello",
      actionable: true,
    });
    expect(projectDiagnosticLogs(logs, 0)).toEqual([]);
    expect(projectPlayerChatEntries(logs, Number.NaN)).toEqual([]);
  });

  test("renders player messages as read-only chat with local hide and collapse actions", async () => {
    const entries: PlayerChatDisplayEntry[] = [
      {
        id: "chat-actionable",
        createdAt: baseTime,
        playerName: "NewPlayer",
        message: "Want to group?",
        actionable: true,
      },
      {
        id: "chat-system",
        createdAt: baseTime - 1_000,
        playerName: "Local",
        message: "Not actionable",
        actionable: false,
      },
    ];
    const wrapper = mount(PlayerChatPanel, { props: { entries } });

    expect(wrapper.get("#player-chat-card").text()).toContain("NewPlayer");
    expect(wrapper.get("#player-chat-card").text()).toContain("Want to group?");
    expect(wrapper.text()).not.toContain("Invite");
    expect(wrapper.text()).not.toContain("Block");
    expect(wrapper.find(".player-chat-actions").exists()).toBe(false);

    await wrapper.get('button[aria-label="Collapse Player Chat"]').trigger("click");
    expect(wrapper.get("#player-chat-card-body").attributes("style")).toContain("display: none");

    await wrapper.get('button[aria-label="Hide Player Chat"]').trigger("click");
    expect(wrapper.emitted("hide")).toEqual([[]]);
  });

  test("normalizes Player Chat as an independently persisted dashboard fixture", () => {
    expect(normalizeHiddenDashboardFixtures([
      "player-chat",
      "live-log",
      "player-chat",
      "retired-panel",
    ])).toEqual(["player-chat", "live-log"]);
  });
});

function chatLog(
  id: string,
  playerName: string,
  message: string,
  actionable: boolean,
): LogEntry {
  return {
    id,
    level: "info",
    message: `Player chat · ${playerName}: ${message}`,
    createdAt: baseTime,
    playerChat: { playerName, message, actionable },
  };
}

function diagnosticLog(id: string, message: string): LogEntry {
  return {
    id,
    level: "info",
    message,
    createdAt: baseTime,
  };
}
