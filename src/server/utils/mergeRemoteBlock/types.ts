/** Minimal Message interface for merge (mirrors RisuAI Message) */
export interface MergeMessage {
  role: 'user' | 'char';
  data: string;
  chatId?: string;
  time?: number;
  saying?: string;
  name?: string;
  otherUser?: boolean;
  disabled?: false | true | 'allBefore';
  isComment?: boolean;
  [key: string]: unknown;
}

/** Minimal Chat interface for merge */
export interface MergeChat {
  id?: string;
  message: MergeMessage[];
  name: string;
  [key: string]: unknown;
}

/** Minimal character interface for merge */
export interface MergeCharData {
  chats: MergeChat[];
  chatPage: number;
  [key: string]: unknown;
}
