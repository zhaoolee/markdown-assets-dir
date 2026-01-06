import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { createHash } from 'crypto';

const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
];

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

type ImageSource =
  | { kind: 'filePath'; path: string; ext: string }
  | { kind: 'dataFile'; file: vscode.DataTransferFile; ext: string };

export function activate(context: vscode.ExtensionContext) {
  const provider: vscode.DocumentPasteEditProvider = {
    async provideDocumentPasteEdits(document, ranges, dataTransfer, context, token) {
      if (token.isCancellationRequested) {
        return;
      }

      if (document.uri.scheme !== 'file') {
        return;
      }

      if (document.isUntitled) {
        void vscode.window.showWarningMessage('Save the Markdown file before pasting images.');
        return;
      }

      const imageItem = pickImageItem(dataTransfer);
      let sources: ImageSource[] = [];

      if (imageItem) {
        const imageFile = imageItem.item.asFile();
        if (!imageFile) {
          return;
        }

        const ext = MIME_TO_EXT[imageItem.mimeType] ?? 'png';
        sources = [{ kind: 'dataFile', file: imageFile, ext }];
      } else {
        sources = await collectImageSourcesFromDataTransfer(dataTransfer);
        if (sources.length === 0) {
          return;
        }
      }

      const mdPath = document.uri.fsPath;
      const mdDir = path.dirname(mdPath);
      const mdBase = path.basename(mdPath, path.extname(mdPath));
      const assetsDir = path.join(mdDir, `${mdBase}_assets`);

      await fs.mkdir(assetsDir, { recursive: true });

      const markdownParts: string[] = [];
      for (const source of sources) {
        const markdownPart = await saveImageSource(source, assetsDir, mdDir);
        markdownParts.push(markdownPart);
      }
      const markdown = markdownParts.join('\n');

      return [
        new vscode.DocumentPasteEdit(
          markdown,
          'Paste image to assets folder',
          vscode.DocumentDropOrPasteEditKind.Empty
        )
      ];
    }
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentPasteEditProvider(
      { language: 'markdown', scheme: 'file' },
      provider,
      {
        pasteMimeTypes: [...IMAGE_MIME_TYPES, 'files', 'text/uri-list'],
        providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty]
      }
    )
  );
}

export function deactivate() {
  // No-op.
}

function pickImageItem(dataTransfer: vscode.DataTransfer): { item: vscode.DataTransferItem; mimeType: string } | undefined {
  for (const mimeType of IMAGE_MIME_TYPES) {
    const item = dataTransfer.get(mimeType);
    if (item) {
      return { item, mimeType };
    }
  }

  return;
}

async function collectImageSourcesFromDataTransfer(dataTransfer: vscode.DataTransfer): Promise<ImageSource[]> {
  const sources: ImageSource[] = [];
  const seenPaths = new Set<string>();

  const uriListItem = dataTransfer.get('text/uri-list') ?? dataTransfer.get('application/vnd.code.uri-list');
  if (uriListItem) {
    const uriList = await uriListItem.asString();
    for (const uri of parseUriList(uriList)) {
      if (uri.scheme !== 'file') {
        continue;
      }

      const filePath = uri.fsPath;
      if (!isSupportedImageFilePath(filePath)) {
        continue;
      }

      if (!seenPaths.has(filePath)) {
        seenPaths.add(filePath);
        sources.push({ kind: 'filePath', path: filePath, ext: extFromFilePath(filePath) });
      }
    }
  }

  for (const [, item] of dataTransfer) {
    const file = item.asFile();
    if (!file) {
      continue;
    }

    const ext = extFromFileName(file.name);
    if (!ext || !isSupportedImageExtension(ext)) {
      continue;
    }

    if (file.uri && file.uri.scheme === 'file') {
      const filePath = file.uri.fsPath;
      if (!isSupportedImageFilePath(filePath)) {
        continue;
      }

      if (!seenPaths.has(filePath)) {
        seenPaths.add(filePath);
        sources.push({ kind: 'filePath', path: filePath, ext: extFromFilePath(filePath) });
      }

      continue;
    }

    sources.push({ kind: 'dataFile', file, ext });
  }

  return sources;
}

async function saveImageSource(source: ImageSource, assetsDir: string, mdDir: string): Promise<string> {
  const ext = normalizeExt(source.ext);
  const bytes = source.kind === 'filePath' ? await fs.readFile(source.path) : await source.file.data();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const fileName = `${hash}.${ext}`;
  const filePath = path.join(assetsDir, fileName);

  if (!(await fileExists(filePath))) {
    await fs.writeFile(filePath, bytes);
  }

  const relativePath = toPosixPath(path.relative(mdDir, filePath));
  const markdownPath = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
  return `![](${markdownPath})`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function parseUriList(uriList: string): vscode.Uri[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => vscode.Uri.parse(line));
}

function extFromFileName(fileName: string): string | undefined {
  const ext = path.extname(fileName).toLowerCase();
  return ext ? ext.slice(1) : undefined;
}

function extFromFilePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext ? ext.slice(1) : 'png';
}

function isSupportedImageFilePath(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isSupportedImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(`.${ext.toLowerCase()}`);
}

function normalizeExt(ext: string): string {
  const trimmed = ext.trim();
  if (!trimmed) {
    return 'png';
  }

  return trimmed.startsWith('.') ? trimmed.slice(1).toLowerCase() : trimmed.toLowerCase();
}
