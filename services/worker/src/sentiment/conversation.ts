import { normalizeAnalysisText } from "./hash.js";

export interface ConversationSegmentItem {
  entityId: string | null;
  parentEntityId: string | null;
  depth: number;
  relation: "ancestor" | "target" | "reply" | "direct_parent";
  text: string;
}

export interface ConversationSegment {
  mode: "comment_with_replies" | "ancestor_chain";
  targetCommentId: string | null;
  truncated: boolean;
  items: ConversationSegmentItem[];
}

export interface ReplyThreadItem {
  depth: number;
  relation: "ancestor" | "direct_parent";
  text: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNullableId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveDepth(value: unknown, fallback: number): number {
  const depth = Number(value);
  return Number.isInteger(depth) && depth >= 0 ? depth : fallback;
}

function parseStructuredItem(
  entry: unknown,
  fallbackDepth: number,
): ConversationSegmentItem | null {
  const record = asRecord(entry);
  const text = normalizeAnalysisText(record?.["text"] as string | undefined);
  if (!text) return null;
  const rawRelation = record?.["relation"];
  const relation =
    rawRelation === "target" || rawRelation === "reply"
      ? rawRelation
      : rawRelation === "direct_parent"
        ? "direct_parent"
        : "ancestor";
  return {
    entityId: asNullableId(record?.["entityId"] ?? record?.["entity_id"]),
    parentEntityId: asNullableId(
      record?.["parentEntityId"] ?? record?.["parent_entity_id"],
    ),
    depth: positiveDepth(record?.["level"] ?? record?.["depth"], fallbackDepth),
    relation,
    text,
  };
}

export function parseConversationSegment(
  value: string | null | undefined,
): ConversationSegment {
  const normalized = normalizeAnalysisText(value);
  if (!normalized) {
    return {
      mode: "ancestor_chain",
      targetCommentId: null,
      truncated: false,
      items: [],
    };
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    const record = asRecord(parsed);
    if (record && Array.isArray(record["items"])) {
      return {
        mode:
          record["mode"] === "comment_with_replies"
            ? "comment_with_replies"
            : "ancestor_chain",
        targetCommentId: asNullableId(record["targetCommentId"]),
        truncated: record["truncated"] === true,
        items: record["items"]
          .map((entry, index) => parseStructuredItem(entry, index))
          .filter((entry): entry is ConversationSegmentItem => entry !== null),
      };
    }

    if (Array.isArray(parsed)) {
      const items = parsed
        .map((entry, index) =>
          parseStructuredItem(entry, parsed.length - index),
        )
        .filter((entry): entry is ConversationSegmentItem => entry !== null)
        .sort((left, right) => right.depth - left.depth);
      return {
        mode: "ancestor_chain",
        targetCommentId: null,
        truncated: false,
        items,
      };
    }
  } catch {
    // Older queue rows can contain a plain-text direct-parent context.
  }

  return {
    mode: "ancestor_chain",
    targetCommentId: null,
    truncated: false,
    items: [
      {
        entityId: null,
        parentEntityId: null,
        depth: 1,
        relation: "direct_parent",
        text: normalized,
      },
    ],
  };
}

export function parseReplyThread(
  value: string | null | undefined,
): ReplyThreadItem[] {
  const segment = parseConversationSegment(value);
  const target = segment.items.find((item) => item.relation === "target");

  return segment.items
    .filter(
      (item) =>
        item.relation === "ancestor" || item.relation === "direct_parent",
    )
    .map((item) => ({
      depth: item.depth,
      relation:
        item.relation === "direct_parent" ||
        (target?.parentEntityId && item.entityId === target.parentEntityId) ||
        (!target && item.depth === 1)
          ? "direct_parent" as const
          : "ancestor" as const,
      text: item.text,
    }));
}

export function directParentText(
  value: string | null | undefined,
): string {
  const thread = parseReplyThread(value);
  return thread.find((item) => item.relation === "direct_parent")?.text ?? "";
}
