// Legacy format types for migration.
type LegacyUpvoter = { name: string; email: string };

export type LegacyComment = {
  dateISO: string;
  content: unknown;
  author: { name: string; email: string };
  usersWhoUpvoted: (string | LegacyUpvoter)[];
  replies?: LegacyComment[];
  parentCommentISO?: string;
};

type CommentActors =
  | {
      authorEmail: string;
      upvoterEmails: string[];
      authorId?: string;
      upvoterIds?: string[];
    }
  | {
      authorId: string;
      upvoterIds?: string[];
      authorEmail?: string;
      upvoterEmails?: string[];
    };

type CommentData = {
  id?: string;
  dateISO: string;
  content: unknown;
  parentCommentId?: string;
  legacyCommentId?: string;
};

/** Supports both the intermediate email format and the current user ID format. */
export type NormalizedComment = CommentActors &
  CommentData & {
    replies?: NormalizedComment[];
  };

export type MigratedComment = CommentActors &
  CommentData & {
    id: string;
    replies?: MigratedComment[];
  };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Invalid voters must invalidate the record, rather than disappear on cleanup. */
function normalizeUpvoters(upvoters: unknown): string[] | null {
  if (upvoters === undefined) return [];
  if (!Array.isArray(upvoters)) return null;

  const emails: string[] = [];
  for (const upvoter of upvoters) {
    if (typeof upvoter === 'string') {
      emails.push(upvoter);
    } else if (isRecord(upvoter) && typeof upvoter.email === 'string') {
      emails.push(upvoter.email);
    } else {
      return null;
    }
  }
  return emails;
}

function stringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === 'string') ? [...value] : null;
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function readAuthorEmail(comment: UnknownRecord): string | null | undefined {
  const author = comment.author;
  if (
    author !== undefined &&
    (!isRecord(author) || typeof author.email !== 'string')
  ) {
    return null;
  }
  if (
    comment.authorEmail !== undefined &&
    typeof comment.authorEmail !== 'string'
  ) {
    return null;
  }
  const legacyEmail = isRecord(author) ? author.email : undefined;
  if (
    legacyEmail !== undefined &&
    comment.authorEmail !== undefined &&
    legacyEmail !== comment.authorEmail
  ) {
    return null;
  }
  return typeof comment.authorEmail === 'string'
    ? comment.authorEmail
    : typeof legacyEmail === 'string'
      ? legacyEmail
      : undefined;
}

function readVoters(comment: UnknownRecord): {
  upvoterEmails: string[];
  upvoterIds: string[];
} | null {
  const legacyVoters = normalizeUpvoters(comment.usersWhoUpvoted);
  const emailVoters = stringArray(comment.upvoterEmails);
  const idVoters = stringArray(comment.upvoterIds);
  if (!legacyVoters || !emailVoters || !idVoters) return null;
  if (
    comment.usersWhoUpvoted !== undefined &&
    comment.upvoterEmails !== undefined &&
    !sameStrings(legacyVoters, emailVoters)
  ) {
    return null;
  }
  return {
    upvoterEmails:
      comment.upvoterEmails === undefined ? legacyVoters : emailVoters,
    upvoterIds: idVoters,
  };
}

function normalizedIdVoters(
  comment: UnknownRecord,
  upvoterIds: string[],
): { upvoterIds?: string[] } {
  if (comment.upvoterIds !== undefined) return { upvoterIds };
  if (
    comment.upvoterEmails !== undefined ||
    comment.usersWhoUpvoted !== undefined
  ) {
    return {};
  }
  return { upvoterIds };
}

function normalizeActors(comment: UnknownRecord): CommentActors | null {
  const authorEmail = readAuthorEmail(comment);
  if (authorEmail === null) return null;
  if (
    comment.authorId !== undefined &&
    (typeof comment.authorId !== 'string' || !comment.authorId)
  ) {
    return null;
  }
  const voters = readVoters(comment);
  if (!voters) return null;
  if (typeof authorEmail === 'string') {
    return {
      authorEmail,
      upvoterEmails: voters.upvoterEmails,
      ...(typeof comment.authorId === 'string' && {
        authorId: comment.authorId,
        ...normalizedIdVoters(comment, voters.upvoterIds),
      }),
    };
  }
  if (typeof comment.authorId === 'string') {
    return {
      authorId: comment.authorId,
      ...normalizedIdVoters(comment, voters.upvoterIds),
      ...(comment.upvoterEmails !== undefined ||
      comment.usersWhoUpvoted !== undefined
        ? { upvoterEmails: voters.upvoterEmails }
        : {}),
    };
  }
  return null;
}

function compareObjectProperties(
  left: object,
  right: object,
  stack: Array<[unknown, unknown]>,
  seen: WeakMap<object, object>,
): boolean {
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const visited = seen.get(left);
  if (visited) return visited === right;
  seen.set(left, right);
  const aRecord = left as UnknownRecord;
  const bRecord = right as UnknownRecord;
  const keys = Object.keys(aRecord);
  if (keys.length !== Object.keys(bRecord).length) return false;
  for (const key of keys) {
    // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn requires ES2022; the plugin targets ES2020.
    if (!Object.prototype.hasOwnProperty.call(bRecord, key)) return false;
    stack.push([aRecord[key], bRecord[key]]);
  }
  return true;
}

/** Checks metadata conflicts without recursion or serializing an entire tree. */
function sameValue(left: unknown, right: unknown): boolean {
  const stack: Array<[unknown, unknown]> = [[left, right]];
  const seen = new WeakMap<object, object>();
  while (stack.length > 0) {
    const pair = stack.pop();
    if (!pair) continue;
    const [a, b] = pair;
    if (a === b) continue;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object')
      return false;
    if (!compareObjectProperties(a, b, stack, seen)) return false;
  }
  return true;
}

function preserveMetadata(
  output: UnknownRecord,
  key: string,
  value: unknown,
): boolean {
  if (value === undefined) return true;
  if (output[key] !== undefined && !sameValue(output[key], value)) return false;
  output[key] = value;
  return true;
}

function validOptionalStrings(comment: UnknownRecord): boolean {
  for (const key of ['id', 'parentCommentISO', 'parentCommentId']) {
    if (
      comment[key] !== undefined &&
      (typeof comment[key] !== 'string' || !comment[key])
    ) {
      return false;
    }
  }
  return true;
}

function normalizeNode(comment: UnknownRecord): NormalizedComment | null {
  if (
    typeof comment.dateISO !== 'string' ||
    !comment.dateISO ||
    !('content' in comment)
  ) {
    return null;
  }
  if (comment.replies !== undefined && !Array.isArray(comment.replies))
    return null;
  if (!validOptionalStrings(comment)) return null;
  if (
    comment.parentCommentISO !== undefined &&
    comment.parentCommentId !== undefined &&
    comment.parentCommentISO !== comment.parentCommentId
  ) {
    return null;
  }
  const actors = normalizeActors(comment);
  if (!actors) return null;
  const { author, usersWhoUpvoted, parentCommentISO, replies, ...rest } =
    comment;
  if (!preserveMetadata(rest, 'legacyAuthor', author)) return null;
  if (!preserveMetadata(rest, 'legacyUpvoters', usersWhoUpvoted)) return null;

  const parentCommentId = comment.parentCommentId ?? parentCommentISO;
  return {
    ...rest,
    ...actors,
    dateISO: comment.dateISO,
    content: comment.content,
    ...(typeof parentCommentId === 'string' && { parentCommentId }),
    ...(replies !== undefined && { replies: [] }),
  };
}

export function normalizeComment(comment: LegacyComment): NormalizedComment {
  const normalized = normalizeCommentIfValid(comment);
  if (!normalized) throw new Error('Cannot normalize malformed comment data');
  return normalized;
}

/** A malformed descendant invalidates the whole tree, so callers can retain the source field. */
export function normalizeCommentIfValid(
  comment: unknown,
): NormalizedComment | null {
  const output: NormalizedComment[] = [];
  const stack: Array<{ source: unknown; target: NormalizedComment[] }> = [
    { source: comment, target: output },
  ];
  const seen = new WeakSet<object>();

  while (stack.length > 0) {
    const next = stack.pop();
    if (!next || !isRecord(next.source) || seen.has(next.source)) return null;
    seen.add(next.source);
    const normalized = normalizeNode(next.source);
    if (!normalized) return null;
    next.target.push(normalized);
    if (Array.isArray(next.source.replies) && normalized.replies) {
      for (let index = next.source.replies.length - 1; index >= 0; index--) {
        stack.push({
          source: next.source.replies[index],
          target: normalized.replies,
        });
      }
    }
  }
  return output[0] ?? null;
}

type CommentWithId = NormalizedComment;

/** Legacy: id missing, equals dateISO, or is an ISO timestamp. */
function isLegacyIdFormat(comment: CommentWithId): boolean {
  if (!comment.id || comment.id === comment.dateISO) return true;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(comment.id);
}

type CommentNode = {
  source: CommentWithId;
  output: MigratedComment;
  parent?: CommentNode;
};

const generatedIdComments = new WeakSet<object>();

/** Persisted metadata alone never authorizes changing an existing comment ID. */
export function commentIdWasMigrated(comment: object): boolean {
  return generatedIdComments.has(comment);
}

function collectCommentNodes(comments: CommentWithId[]): {
  nodes: CommentNode[];
  output: MigratedComment[];
} {
  const nodes: CommentNode[] = [];
  const output: MigratedComment[] = [];
  const seen = new WeakSet<object>();
  const stack: Array<{
    source: CommentWithId;
    target: MigratedComment[];
    parent?: CommentNode;
  }> = [];
  for (let index = comments.length - 1; index >= 0; index--) {
    stack.push({ source: comments[index], target: output });
  }
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) continue;
    if (!isRecord(next.source) || seen.has(next.source)) {
      throw new Error('Cannot migrate cyclic or shared comment data');
    }
    seen.add(next.source);
    const { replies, ...source } = next.source;
    const copied: MigratedComment = {
      ...source,
      id: source.id ?? '',
      ...(replies !== undefined && { replies: [] }),
    };
    const node = { source: next.source, output: copied, parent: next.parent };
    nodes.push(node);
    next.target.push(copied);
    if (next.source.replies && copied.replies) {
      for (let index = next.source.replies.length - 1; index >= 0; index--) {
        stack.push({
          source: next.source.replies[index],
          target: copied.replies,
          parent: node,
        });
      }
    }
  }
  return { nodes, output };
}

function rememberAlias(
  aliases: Map<string, CommentNode | null>,
  key: string,
  node: CommentNode,
): void {
  if (!aliases.has(key)) {
    aliases.set(key, node);
  } else if (aliases.get(key) !== node) {
    aliases.set(key, null);
  }
}

function uniqueUuid(reserved: Set<string>): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = crypto.randomUUID();
    if (!reserved.has(id)) {
      reserved.add(id);
      return id;
    }
  }
  throw new Error('Could not generate a unique comment ID');
}

function resolveParent(
  node: CommentNode,
  identifiers: Map<string, CommentNode | null>,
  timestamps: Map<string, CommentNode | null>,
): string | undefined {
  const reference = node.source.parentCommentId;
  if (reference === undefined) return node.parent?.output.id;
  const parent = node.parent;
  if (
    parent &&
    (reference === parent.source.id || reference === parent.source.dateISO)
  ) {
    return parent.output.id;
  }
  const target = identifiers.has(reference)
    ? identifiers.get(reference)
    : timestamps.get(reference);
  if (!target || target === node) {
    throw new Error(
      `Comment parent reference is missing or ambiguous: ${reference}`,
    );
  }
  return target.output.id;
}

function verifyParentCycles(nodes: CommentNode[]): void {
  const byId = new Map(nodes.map((node) => [node.output.id, node]));
  const visited = new Set<CommentNode>();
  for (const node of nodes) {
    const path = new Set<CommentNode>();
    let current: CommentNode | undefined = node;
    while (current && !visited.has(current)) {
      if (path.has(current))
        throw new Error('Cyclic comment parent references');
      path.add(current);
      current = current.output.parentCommentId
        ? byId.get(current.output.parentCommentId)
        : undefined;
    }
    for (const entry of path) visited.add(entry);
  }
}

function reserveModernIds(nodes: CommentNode[]): Set<string> {
  const reserved = new Set<string>();
  for (const node of nodes) {
    if (isLegacyIdFormat(node.source)) continue;
    const id = node.source.id;
    if (id && reserved.has(id))
      throw new Error(`Duplicate modern comment ID: ${id}`);
    if (id) reserved.add(id);
  }
  return reserved;
}

function assignLegacyId(node: CommentNode, reserved: Set<string>) {
  const previousId = node.source.id ?? node.source.dateISO;
  if (
    node.source.legacyCommentId !== undefined &&
    node.source.legacyCommentId !== previousId
  ) {
    throw new Error('Legacy comment ID metadata conflicts with the source ID.');
  }
  node.output.id = uniqueUuid(reserved);
  node.output.legacyCommentId = previousId;
  generatedIdComments.add(node.output);
}

function assignCommentIds(nodes: CommentNode[], reserved: Set<string>) {
  let wasMigrated = false;
  const identifiers = new Map<string, CommentNode | null>();
  const timestamps = new Map<string, CommentNode | null>();
  for (const node of nodes) {
    if (isLegacyIdFormat(node.source)) {
      assignLegacyId(node, reserved);
      wasMigrated = true;
    }
    rememberAlias(identifiers, node.source.id ?? node.source.dateISO, node);
    rememberAlias(timestamps, node.source.dateISO, node);
  }
  return { identifiers, timestamps, wasMigrated };
}

function updateParentReferences(
  nodes: CommentNode[],
  identifiers: Map<string, CommentNode | null>,
  timestamps: Map<string, CommentNode | null>,
): boolean {
  let changed = false;
  for (const node of nodes) {
    const parentCommentId = resolveParent(node, identifiers, timestamps);
    if (parentCommentId !== node.source.parentCommentId) {
      node.output.parentCommentId = parentCommentId;
      changed = true;
    }
  }
  return changed;
}

/** Two passes resolve forward references and duplicate timestamps without order-dependent rewrites. */
export function migrateCommentsToUuid(comments: CommentWithId[]): {
  comments: MigratedComment[];
  wasMigrated: boolean;
} {
  const { nodes, output } = collectCommentNodes(comments);
  const reserved = reserveModernIds(nodes);
  const assigned = assignCommentIds(nodes, reserved);
  const changedParents = updateParentReferences(
    nodes,
    assigned.identifiers,
    assigned.timestamps,
  );
  const wasMigrated = assigned.wasMigrated || changedParents;
  verifyParentCycles(nodes);
  return {
    comments: wasMigrated ? output : (comments as MigratedComment[]),
    wasMigrated,
  };
}
