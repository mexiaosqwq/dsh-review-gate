import type { UserMessage } from '@deepseek-ai/dsh-llm';
export declare const MICRO_TEXT: (files: number) => string;
export declare const FULL_TEXT: (files: number) => string;
export declare function reviewInstructionText(action: 'micro' | 'full', files: number, pitfallsText?: string): string;
export declare const DRIVER_HINT = "(review-gate) \u6536\u5C3E\u590D\u5BA1\u672A\u5B8C\u6210\uFF1A\u8BF7\u6267\u884C\u8FD0\u884C\u65F6\u4E0A\u4E0B\u6587\u4E2D\u7684\u590D\u5BA1\uFF0C\u5B8C\u6210\u540E\u8C03\u7528 review_acknowledge \u56DE\u6267\uFF0C\u7136\u540E\u8F93\u51FA\u6700\u7EC8\u603B\u7ED3\uFF08\u542B\u590D\u5BA1\u7ED3\u8BBA\u4E0E\u672C\u6B21\u4EFB\u52A1\u505A\u4E86\u4EC0\u4E48\uFF09\u3002\u82E5\u5DF2\u56DE\u6267\uFF0C\u672C\u6D88\u606F\u4E3A\u91CD\u53D1\u2014\u2014\u76F4\u63A5\u7ED3\u6848\uFF0C\u65E0\u9700\u518D\u767B\u8BB0\u3002";
export declare function buildDriverMessage(fileCount: number): UserMessage;
export declare function buildReviewMessage(action: 'micro' | 'full', fileCount: number): UserMessage;
