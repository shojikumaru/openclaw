import { describe, expect, it } from "vitest";
import { buzzSetupPlugin } from "../setup-plugin-api.js";
import { buzzPlugin } from "./channel.js";

describe("Buzz channel guidance", () => {
  const roomId = "64f4debf-e7af-438c-8dcd-d6fbbe77405d";
  const otherRoomId = "2cff47ef-1d14-4d5c-8069-82b769bf1736";
  const threadId = "584e8d00bab48310ea80ff5f62550f824242bbc333fc4c259d7ae80be025c8aa";

  it.each([
    ["runtime", buzzPlugin],
    ["setup", buzzSetupPlugin],
  ] as const)("%s opts into isolated named-account reloads", (_surface, plugin) => {
    expect(plugin.reload).toEqual({
      configPrefixes: ["channels.buzz"],
      accountScopedRestart: true,
    });
  });

  it.each([
    {
      label: "automatic off",
      replyDelivery: { replyToMode: "off" as const },
      explicit: false,
      expected: { threadId: null, replyToId: null },
    },
    {
      label: "automatic all",
      replyDelivery: { replyToMode: "all" as const },
      explicit: false,
      expected: { threadId: "thread-root", replyToId: "thread-root" },
    },
    {
      label: "implicit message tool",
      replyDelivery: undefined,
      explicit: false,
      expected: { threadId: "thread-root", replyToId: "thread-root" },
    },
    {
      label: "explicit child",
      replyDelivery: undefined,
      explicit: true,
      expected: { threadId: "thread-root", replyToId: "requested-parent" },
    },
  ])("routes $label replies at the intended depth", ({ replyDelivery, explicit, expected }) => {
    const original = { threadId: "thread-root", replyToId: "requested-parent" };
    const transport =
      buzzPlugin.threading?.resolveReplyTransport?.({
        cfg: {},
        ...original,
        replyToIsExplicit: explicit,
        replyDelivery,
      }) ?? original;
    expect(transport).toEqual(expected);
  });

  it("recovers the current Buzz thread for an implicit same-room message-tool reply", () => {
    const threading = buzzPlugin.threading;
    const toolContext = threading?.buildToolContext?.({
      cfg: {},
      context: {
        To: `buzz:${roomId}`,
        NativeChannelId: roomId,
        ChatType: "group",
        CurrentMessageId: "mid-thread-message",
        MessageThreadId: threadId,
        ReplyToMode: "all",
      },
      hasRepliedRef: { value: false },
    });

    expect(toolContext).toMatchObject({
      currentChannelId: roomId,
      currentChatType: "group",
      currentMessagingTarget: `buzz:${roomId}`,
      currentThreadTs: threadId,
      currentMessageId: "mid-thread-message",
      replyToMode: "all",
      sameChannelThreadRequired: true,
    });

    const recoveredThreadId = threading?.resolveAutoThreadId?.({
      cfg: {},
      to: roomId,
      toolContext,
      replyToId: "mid-thread-message",
    });
    expect(recoveredThreadId).toBe(threadId);
    expect(
      threading?.resolveReplyTransport?.({
        cfg: {},
        threadId: recoveredThreadId,
        replyToId: "mid-thread-message",
        replyToIsExplicit: false,
      }),
    ).toEqual({ threadId, replyToId: threadId });
  });

  it("does not inherit a Buzz thread across rooms, without a root, or when replies are off", () => {
    const resolveAutoThreadId = buzzPlugin.threading?.resolveAutoThreadId;
    const baseToolContext = {
      currentChannelId: `buzz:${roomId}`,
      currentMessagingTarget: `buzz:${roomId}`,
      currentThreadTs: threadId,
      replyToMode: "all" as const,
    };

    expect(
      resolveAutoThreadId?.({ cfg: {}, to: `buzz:${otherRoomId}`, toolContext: baseToolContext }),
    ).toBeUndefined();
    expect(
      resolveAutoThreadId?.({
        cfg: {},
        to: `buzz:${roomId}`,
        toolContext: { ...baseToolContext, currentThreadTs: undefined },
      }),
    ).toBeUndefined();
    expect(
      resolveAutoThreadId?.({
        cfg: {},
        to: `buzz:${roomId}`,
        toolContext: { ...baseToolContext, replyToMode: "off" },
      }),
    ).toBeUndefined();
    expect(
      resolveAutoThreadId?.({ cfg: {}, to: "not-a-buzz-room", toolContext: baseToolContext }),
    ).toBeUndefined();
  });
  it("advertises directory room targets and native mention syntax", () => {
    const hints = buzzPlugin.agentPrompt?.messageToolHints?.({} as never) ?? [];

    expect(hints).toContain(
      "- Buzz targets: use a configured room UUID, `buzz:<ROOM_UUID>`, or a unique current room name. Use the UUID when room names are ambiguous.",
    );
    expect(hints).toContain(
      "- Buzz mentions: write a unique current room member as `@Display Name`. For an explicit identity, include `nostr:npub...`; the public key must belong to the target room. Any unresolved or ambiguous label needs an explicit identity for every intended member.",
    );
    expect(buzzPlugin.messaging?.targetResolver?.hint).toBe("<room UUID|configured room name>");
  });

  it("resolves Buzz reply sessions without treating the thread as part of the room UUID", () => {
    expect(
      buzzPlugin.messaging?.resolveSessionConversation?.({
        kind: "group",
        rawId: `buzz:${roomId}:thread:${threadId}`,
      }),
    ).toEqual({
      id: roomId,
      threadId,
      baseConversationId: roomId,
      parentConversationCandidates: [roomId],
    });
  });
});
