/**
 * Minimal VS Code API mock for unit tests.
 * Only the symbols actually used by the source files under test are provided.
 */

export class Uri {
    readonly fsPath: string;
    readonly scheme: string = 'file';
    readonly path: string;

    private constructor(fsPath: string) {
        this.fsPath = fsPath;
        this.path = fsPath;
    }
    static file(p: string): Uri {
        return new Uri(p);
    }
    static parse(value: string): Uri {
        return new Uri(value);
    }
    toString(): string {
        return `file://${this.fsPath}`;
    }
}

export class Position {
    constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
    constructor(
        public readonly startLine: number,
        public readonly startChar: number,
        public readonly endLine: number,
        public readonly endChar: number
    ) {}

    get start() {
        return new Position(this.startLine, this.startChar);
    }
    get end() {
        return new Position(this.endLine, this.endChar);
    }
}

export class MarkdownString {
    constructor(public readonly value: string = '') {}
}

export class CodeLens {
    constructor(
        public readonly range: Range,
        public command?: { command: string; title: string; tooltip?: string; arguments?: unknown[] }
    ) {}
}

export class CompletionItem {
    insertText?: string;
    detail?: string;
    documentation?: MarkdownString;
    constructor(public readonly label: string, public readonly kind?: number) {}
}

export enum CompletionItemKind {
    Constant = 1,
    Module = 2,
    EnumMember = 3,
    Value = 4,
}

export class InlayHint {
    paddingLeft = false;
    paddingRight = false;
    tooltip?: MarkdownString;
    constructor(
        public readonly position: Position,
        public readonly label: string,
        public readonly kind?: number
    ) {}
}

export enum InlayHintKind {
    Type = 1,
    Parameter = 2,
}

export class ThemeIcon {
    constructor(public readonly id: string) {}
}

export class TreeItem {
    id?: string;
    contextValue?: string;
    iconPath?: unknown;
    description?: string;
    tooltip?: string;
    resourceUri?: Uri;
    command?: { command: string; title: string; arguments?: unknown[] };
    constructor(public readonly label: string, public readonly collapsibleState?: number) {}
}

export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2,
}

export class EventEmitter<T> {
    private listeners: Array<(v: T) => void> = [];
    readonly event = (l: (v: T) => void) => {
        this.listeners.push(l);
        return { dispose: () => (this.listeners = this.listeners.filter(x => x !== l)) };
    };
    fire(v: T) {
        for (const l of this.listeners) l(v);
    }
}

export class CancellationTokenSource {
    token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
    cancel() {
        this.token.isCancellationRequested = true;
    }
    dispose() {}
}

export const workspace = {
    getConfiguration: (_section?: string, _scope?: unknown) => ({
        get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
    }),
    workspaceFolders: undefined as unknown[] | undefined,
    findFiles: async () => [],
    createFileSystemWatcher: () => ({
        onDidCreate: () => ({ dispose() {} }),
        onDidChange: () => ({ dispose() {} }),
        onDidDelete: () => ({ dispose() {} }),
        dispose() {},
    }),
    onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    getWorkspaceFolder: (_uri: Uri) => undefined,
    openTextDocument: async (_uri: Uri) => ({}),
};

export const window = {
    activeTextEditor: undefined as unknown,
    createOutputChannel: (_name: string) => ({
        appendLine: (_s: string) => {},
        append: (_s: string) => {},
        show: (_p?: boolean) => {},
        dispose: () => {},
    }),
    createTreeView: () => ({ dispose() {} }),
    showInputBox: async () => undefined,
    showInformationMessage: async (_m: string) => undefined,
    showTextDocument: async () => ({}),
};

export const commands = {
    registerCommand: () => ({ dispose() {} }),
};

export const languages = {
    registerCodeLensProvider: () => ({ dispose() {} }),
    registerInlayHintsProvider: () => ({ dispose() {} }),
    registerCompletionItemProvider: () => ({ dispose() {} }),
};

export const lm = {
    registerTool: (_name: string, _tool: unknown) => ({ dispose() {} }),
};

export class LanguageModelToolResult {
    constructor(public readonly content: unknown[]) {}
}
export class LanguageModelTextPart {
    constructor(public readonly value: string) {}
}

export const extensions = {
    getExtension: (_id: string) => undefined,
};

export default {
    Uri,
    Position,
    Range,
    MarkdownString,
    CodeLens,
    CompletionItem,
    CompletionItemKind,
    InlayHint,
    InlayHintKind,
    ThemeIcon,
    TreeItem,
    TreeItemCollapsibleState,
    EventEmitter,
    CancellationTokenSource,
    workspace,
    window,
    commands,
    languages,
    lm,
    LanguageModelToolResult,
    LanguageModelTextPart,
    extensions,
};
