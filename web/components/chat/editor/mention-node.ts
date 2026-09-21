import {
  $applyNodeReplacement,
  $getState,
  $setState,
  createState,
  type EditorConfig,
  type LexicalNode,
  TextNode,
} from "lexical";

/**
 * 入力欄の中のメンション（ADR 0052 決定 4）。
 *
 * 見た目は `@名前`、書き出すと本文のトークン（`<@ULID>` / `<!channel>` / `<!here>`。ADR 0041）になる。
 * token モードの TextNode なので、1 文字のように消え、途中にキャレットを置けない（名前の一部だけ消えて別の人を指すことがない）。
 * トークンは NodeState に持つ。複製・JSON への書き出しは Lexical が面倒を見る。
 */
const tokenState = createState("token", { parse: (v) => (typeof v === "string" ? v : "") });

/** チップの見た目は本文と同じ（message-body.tsx）。個人は押せるものの緑、全員宛ては琥珀。 */
const USER_CHIP = "rounded-sm bg-primary-subtle px-1 font-semibold text-primary";
const ALL_CHIP = "rounded-sm bg-attention px-1 font-semibold text-on-attention";

export class MentionNode extends TextNode {
  $config() {
    return this.config("mention", { extends: TextNode, stateConfigs: [{ stateConfig: tokenState, flat: true }] });
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.className = $mentionToken(this).startsWith("<@") ? USER_CHIP : ALL_CHIP;
    element.spellcheck = false;
    return element;
  }

  isTextEntity(): true {
    return true;
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }
}

/** メンションのノードを作る。token は本文のトークン、label は入力欄に出す `@名前`。 */
export function $createMentionNode(token: string, label: string): MentionNode {
  const node = $applyNodeReplacement(new MentionNode(label));
  $setState(node, tokenState, token);
  return node.setMode("token");
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode;
}

/** メンションのノードが持つ本文のトークン。 */
export function $mentionToken(node: MentionNode): string {
  return $getState(node, tokenState);
}
